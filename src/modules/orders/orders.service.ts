import { Injectable, Logger } from '@nestjs/common';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { TrackingResponseDto } from './dto/tracking-response.dto';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { RidersService } from '../riders/riders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PackingTimerService } from './packing-timer.service';
import { calculateOrderFinancials, validateOrderFinancials } from '../../utils/pricing.util';
import { processOrderPayouts } from '../../services/wallet.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  
  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingGateway: TrackingGateway,
    private readonly ridersService: RidersService,
    private readonly notificationsService: NotificationsService,
    private readonly packingTimerService: PackingTimerService,
  ) {}

  async createOrder(input: {
    userId: string;
    dto: CreateOrderDto;
  }): Promise<{
    orderId: string;
    orderNumber: string;
    status: OrderStatus;
    otpCode: string;
    totalAmount: number;
    paymentStatus: PaymentStatus;
    financials: {
      productAmount: number;
      deliveryFee: number;
      platformFee: number;
      packingCharge: number;
      gstAmount: number;
      distanceKm: number;
    };
  }> {
    const store = await this.prisma.store.findUnique({
      where: { id: input.dto.storeId },
      select: { id: true, latitude: true, longitude: true },
    });

    if (!store) throw new NotFoundException('Store not found');

    const items = input.dto.items;
    const uniqueKey = (i: { productId: string; size: string }) =>
      `${i.productId}:${i.size}`;
    const seen = new Set<string>();
    for (const i of items) {
      const key = uniqueKey(i);
      if (seen.has(key)) throw new BadRequestException('Duplicate items');
      seen.add(key);
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, storeId: input.dto.storeId },
      select: { id: true, price: true, name: true },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException('Invalid product for store');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    const inventoryRecords = await this.prisma.inventory.findMany({
      where: {
        productId: { in: productIds },
        size: { in: items.map((i) => i.size) },
      },
      select: { id: true, productId: true, size: true, stock: true },
    });

    const invByKey = new Map(
      inventoryRecords.map((inv) => [uniqueKey(inv), inv]),
    );

    for (const i of items) {
      const inv = invByKey.get(uniqueKey(i));
      if (!inv) throw new BadRequestException('Inventory not found');
      if (inv.stock < i.quantity) {
        throw new BadRequestException('Insufficient stock');
      }
    }

    const productAmount = items.reduce((sum, i) => {
      const product = productMap.get(i.productId);
      return sum + (product?.price ?? 0) * i.quantity;
    }, 0);

    // Calculate full financial breakdown using pricing engine
    const financials = calculateOrderFinancials(
      productAmount,
      store.latitude,
      store.longitude,
      input.dto.deliveryLat,
      input.dto.deliveryLng
    );

    // Validate financials
    const validation = validateOrderFinancials(financials);
    if (!validation.valid) {
      this.logger.warn(`Financial validation warnings: ${validation.errors.join(', ')}`);
    }

    const orderNumber = await this.generateOrderNumber();
    const otpCode = this.generateOtp();

    const created = await this.prisma.$transaction(async (tx) => {
      for (const i of items) {
        const inv = invByKey.get(uniqueKey(i));
        if (!inv) throw new BadRequestException('Inventory not found');
        await tx.inventory.update({
          where: { id: inv.id },
          data: { stock: { decrement: i.quantity } },
        });
      }

      const paymentStatus =
        input.dto.paymentMethod === 'COD'
          ? PaymentStatus.PENDING
          : PaymentStatus.PENDING;

      const order = await tx.order.create({
        data: {
          orderNumber,
          userId: input.userId,
          storeId: input.dto.storeId,
          status: OrderStatus.PENDING,
          paymentMethod: input.dto.paymentMethod,
          paymentStatus,
          totalAmount: financials.totalAmount,
          otpCode,
          deliveryLat: input.dto.deliveryLat,
          deliveryLng: input.dto.deliveryLng,
          deliveryAddress: input.dto.deliveryAddress,
          // Financial breakdown
          distanceKm: financials.distanceKm,
          productAmount: financials.productAmount,
          deliveryFee: financials.deliveryFee,
          riderEarning: financials.riderEarning,
          deliveryMargin: financials.deliveryMargin,
          commissionAmount: financials.commissionAmount,
          platformFee: financials.platformFee,
          packingCharge: financials.packingCharge,
          gstAmount: financials.gstAmount,
          storeEarning: financials.storeEarning,
          platformEarning: financials.platformEarning,
          items: {
            create: items.map((i) => {
              const product = productMap.get(i.productId);
              return {
                productId: i.productId,
                productName: product?.name ?? '',
                size: i.size,
                quantity: i.quantity,
                unitPrice: product?.price ?? 0,
              };
            }),
          },
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          otpCode: true,
          totalAmount: true,
          paymentStatus: true,
          storeId: true,
        },
      });

      return order;
    });

    this.logger.log(`Order created: ${created.id}, storeId: ${created.storeId}`);

    // Emit real-time event with full order details
    const fullOrder = await this.prisma.order.findUnique({
      where: { id: created.id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        paymentMethod: true,
        paymentStatus: true,
        otpCode: true,
        deliveryLat: true,
        deliveryLng: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, phone: true },
        },
        store: {
          select: { id: true, name: true, address: true },
        },
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            size: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
    });

    // Get product details for items
    const itemProductIds = fullOrder?.items.map(i => i.productId) || [];
    const itemProducts = await this.prisma.product.findMany({
      where: { id: { in: itemProductIds } },
      select: { id: true, name: true, images: true },
    });
    const itemProductMap = new Map(itemProducts.map(p => [p.id, p]));

    const orderWithProductDetails = fullOrder ? {
      ...fullOrder,
      items: fullOrder.items.map(item => ({
        ...item,
        product: itemProductMap.get(item.productId) || null,
      })),
    } : null;

    // Emit real-time event to store with full order details
    this.trackingGateway.emitToStore(created.storeId, 'order.created', orderWithProductDetails);

    // Send push notification to store owner with full order details
    await this.notificationsService.notifyStoreOwnerNewOrder({
      storeId: created.storeId,
      order: orderWithProductDetails,
    });

    return {
      orderId: created.id,
      orderNumber: created.orderNumber,
      status: created.status,
      otpCode: created.otpCode,
      totalAmount: created.totalAmount,
      paymentStatus: created.paymentStatus,
      financials: {
        productAmount: financials.productAmount,
        deliveryFee: financials.deliveryFee,
        platformFee: financials.platformFee,
        packingCharge: financials.packingCharge,
        gstAmount: financials.gstAmount,
        distanceKm: financials.distanceKm,
      },
    };
  }

  async updateStatus(input: {
    actor: { userId: string; role: Role };
    orderId: string;
    dto: UpdateOrderStatusDto;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: { store: true },
    });

    if (!order) throw new NotFoundException('Order not found');

    // Store ownership validation
    if (input.actor.role === Role.STORE && order.store.ownerId !== input.actor.userId) {
      throw new ForbiddenException('Not your store order');
    }

    // Customer can only cancel their own orders
    if (input.actor.role === Role.CUSTOMER && order.userId !== input.actor.userId) {
      throw new ForbiddenException('Not your order');
    }

    if (!this.canTransition(input.actor.role, order.status, input.dto.status)) {
      throw new ForbiddenException('Illegal status transition');
    }

    // Delivery verification - require OTP for DELIVERED status
    if (input.dto.status === OrderStatus.DELIVERED) {
      if (!input.dto.otpCode) {
        throw new BadRequestException('Verification code required for delivery confirmation');
      }
      if (input.dto.otpCode !== order.otpCode) {
        throw new ForbiddenException('Invalid verification code');
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: input.dto.status },
      select: { 
        id: true, 
        status: true, 
        storeId: true, 
        riderId: true, 
        orderNumber: true, 
        userId: true,
        storeEarning: true,
        riderEarning: true,
      },
    });

    // Process wallet payouts when order is delivered
    if (updated.status === OrderStatus.DELIVERED && updated.riderId) {
      try {
        await processOrderPayouts(
          updated.id,
          updated.storeId,
          updated.riderId,
          updated.storeEarning,
          updated.riderEarning
        );
        this.logger.log(`Wallet payouts processed for order ${updated.id}: Store +${updated.storeEarning}, Rider +${updated.riderEarning}`);
      } catch (error) {
        this.logger.error(`Failed to process wallet payouts for order ${updated.id}:`, error);
      }
    }

    // Start packing timer when order is accepted
    if (updated.status === OrderStatus.ACCEPTED) {
      await this.packingTimerService.startPackingTimer({
        orderId: updated.id,
        storeId: updated.storeId,
      });
    }

    // Complete packing timer early when order is packed
    if (updated.status === OrderStatus.READY) {
      await this.packingTimerService.completePackingEarly({ orderId: updated.id });
    }

    if (updated.status === OrderStatus.READY) {
      const nearest = await this.ridersService.findNearestRider({
        lat: order.deliveryLat,
        lng: order.deliveryLng,
      });

      if (nearest) {
        const assigned = await this.prisma.order.update({
          where: { id: updated.id },
          data: { riderId: nearest.riderId },
          select: { id: true, riderId: true, storeId: true, status: true },
        });

        this.trackingGateway.emitToRider(nearest.riderId, 'order_assigned', {
          orderId: assigned.id,
          storeId: assigned.storeId,
          status: assigned.status,
        });

        this.trackingGateway.emitToStore(assigned.storeId, 'rider_assigned', {
          orderId: assigned.id,
          riderId: assigned.riderId,
        });

        this.trackingGateway.emitToOrder(assigned.id, 'rider_assigned', {
          orderId: assigned.id,
          riderId: assigned.riderId,
        });

        updated.riderId = assigned.riderId;
      }
    }

    // Emit real-time events and push notifications based on status
    await this.emitOrderEvents(updated, order.orderNumber);

    return updated;
  }

  async getTracking(input: {
    actor: { userId: string; role: Role };
    orderId: string;
  }): Promise<TrackingResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: {
        store: { select: { id: true, name: true, latitude: true, longitude: true, address: true, ownerId: true } },
        rider: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    if (input.actor.role === Role.CUSTOMER && order.userId !== input.actor.userId) {
      throw new ForbiddenException('Not your order');
    }

    if (input.actor.role === Role.STORE && order.store.ownerId !== input.actor.userId) {
      throw new ForbiddenException('Not your store order');
    }

    if (input.actor.role === Role.RIDER && order.riderId !== input.actor.userId) {
      throw new ForbiddenException('Not your assigned order');
    }

    const live =
      order.riderId ? await this.ridersService.getLiveLocation({ riderId: order.riderId, orderId: order.id }) : null;

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      etaMinutes: null,
      store: {
        id: order.store.id,
        name: order.store.name,
        latitude: order.store.latitude,
        longitude: order.store.longitude,
        address: order.store.address,
      },
      rider: order.riderId
        ? {
            id: order.rider!.id,
            name: order.rider!.name ?? 'Rider',
            phone: order.rider!.phone ?? '',
          }
        : null,
      liveRiderLocation: live
        ? { latitude: live.latitude, longitude: live.longitude, updatedAt: live.updatedAt }
        : null,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    };
  }

  async getCustomerOrders(input: {
    userId: string;
    status?: OrderStatus;
    limit?: number;
    offset?: number;
  }) {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    const where = {
      userId: input.userId,
      ...(input.status && { status: input.status }),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          paymentMethod: true,
          paymentStatus: true,
          createdAt: true,
          updatedAt: true,
          store: {
            select: { id: true, name: true, address: true },
          },
          items: {
            select: {
              id: true,
              productId: true,
              productName: true,
              size: true,
              quantity: true,
              unitPrice: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { orders, total, limit, offset };
  }

  async getStoreOrders(input: {
    ownerId: string;
    status?: OrderStatus;
    limit?: number;
    offset?: number;
  }) {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;

    // Find store by owner
    const store = await this.prisma.store.findUnique({
      where: { ownerId: input.ownerId },
      select: { id: true },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const where = {
      storeId: store.id,
      ...(input.status && { status: input.status }),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          paymentMethod: true,
          paymentStatus: true,
          otpCode: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: { id: true, name: true, phone: true },
          },
          items: {
            select: {
              id: true,
              productId: true,
              productName: true,
              size: true,
              quantity: true,
              unitPrice: true,
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { orders, total, limit, offset };
  }

  async getOrderDetails(input: {
    actor: { userId: string; role: Role };
    orderId: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: {
        store: { select: { id: true, name: true, address: true, ownerId: true } },
        user: { select: { id: true, name: true, phone: true } },
        rider: { select: { id: true, name: true, phone: true } },
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            size: true,
            quantity: true,
            unitPrice: true,
            offerPercentage: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    // Security: Customer can only view their own orders
    if (input.actor.role === Role.CUSTOMER && order.userId !== input.actor.userId) {
      throw new ForbiddenException('Not your order');
    }

    // Security: Store can only view its own orders
    if (input.actor.role === Role.STORE && order.store.ownerId !== input.actor.userId) {
      throw new ForbiddenException('Not your store order');
    }

    // Security: Rider can only view assigned orders
    if (input.actor.role === Role.RIDER && order.riderId !== input.actor.userId) {
      throw new ForbiddenException('Not your assigned order');
    }

    return order;
  }

  private canTransition(role: Role, from: OrderStatus, to: OrderStatus) {
    const allowedNext: Record<OrderStatus, OrderStatus[]> = {
      PENDING: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
      ACCEPTED: [OrderStatus.PACKING, OrderStatus.CANCELLED],
      PACKING: [OrderStatus.READY, OrderStatus.CANCELLED],
      READY: [OrderStatus.PICKED_UP, OrderStatus.CANCELLED],
      PICKED_UP: [OrderStatus.OUT_FOR_DELIVERY],
      OUT_FOR_DELIVERY: [OrderStatus.DELIVERED],
      DELIVERED: [],
      CANCELLED: [],
    };

    if (!allowedNext[from].includes(to)) return false;

    const roleAllowed: Record<OrderStatus, Role[]> = {
      PENDING: [Role.STORE, Role.ADMIN, Role.CUSTOMER],
      ACCEPTED: [Role.STORE, Role.ADMIN],
      PACKING: [Role.STORE, Role.ADMIN],
      READY: [Role.RIDER, Role.ADMIN],
      PICKED_UP: [Role.RIDER, Role.ADMIN],
      OUT_FOR_DELIVERY: [Role.RIDER, Role.ADMIN],
      DELIVERED: [Role.RIDER, Role.ADMIN],
      CANCELLED: [Role.CUSTOMER, Role.STORE, Role.ADMIN],
    };

    return roleAllowed[to].includes(role);
  }

  private async emitOrderEvents(
    order: { id: string; status: OrderStatus; storeId: string; riderId?: string | null; orderNumber: string; userId: string },
    orderNumber: string,
  ) {
    const eventMap: Partial<Record<OrderStatus, string>> = {
      [OrderStatus.ACCEPTED]: 'order.accepted',
      [OrderStatus.PACKING]: 'order.packing',
      [OrderStatus.READY]: 'order.packed',
      [OrderStatus.PICKED_UP]: 'order.submitted',
      [OrderStatus.OUT_FOR_DELIVERY]: 'order.out_for_delivery',
      [OrderStatus.DELIVERED]: 'order.delivered',
    };

    const eventName = eventMap[order.status];
    if (eventName) {
      // Emit real-time events
      this.trackingGateway.emitToOrder(order.id, eventName, {
        orderId: order.id,
        status: order.status,
        orderNumber,
      });

      this.trackingGateway.emitToStore(order.storeId, eventName, {
        orderId: order.id,
        status: order.status,
        orderNumber,
      });

      if (order.riderId) {
        this.trackingGateway.emitToRider(order.riderId, eventName, {
          orderId: order.id,
          status: order.status,
        });
      }
    }

    // Send push notifications based on status
    switch (order.status) {
      case OrderStatus.ACCEPTED:
        await this.notificationsService.notifyCustomerOrderAccepted({
          customerId: order.userId,
          orderId: order.id,
          orderNumber,
        });
        break;
      case OrderStatus.READY:
        await this.notificationsService.notifyCustomerOrderPacked({
          customerId: order.userId,
          orderId: order.id,
          orderNumber,
        });
        break;
      case OrderStatus.PICKED_UP:
        await this.notificationsService.notifyCustomerOrderSubmitted({
          customerId: order.userId,
          orderId: order.id,
          orderNumber,
        });
        break;
      case OrderStatus.OUT_FOR_DELIVERY:
        await this.notificationsService.notifyCustomerOrderOutForDelivery({
          customerId: order.userId,
          orderId: order.id,
          orderNumber,
        });
        break;
      case OrderStatus.DELIVERED:
        await this.notificationsService.notifyCustomerOrderDelivered({
          customerId: order.userId,
          orderId: order.id,
          orderNumber,
        });
        break;
    }
  }

  private generateOtp() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  private async generateOrderNumber() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Math.floor(100000 + Math.random() * 900000);
      const orderNumber = `OUTFYT-${suffix}`;
      const existing = await this.prisma.order.findUnique({
        where: { orderNumber },
        select: { id: true },
      });

      if (!existing) return orderNumber;
    }

    throw new BadRequestException('Failed to generate order number');
  }
}
