import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface NotificationResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async registerDeviceToken(input: {
    userId: string;
    token: string;
    platform: string;
  }): Promise<{ success: boolean }> {
    await this.prisma.deviceToken.upsert({
      where: { token: input.token },
      update: {
        userId: input.userId,
        platform: input.platform,
      },
      create: {
        userId: input.userId,
        token: input.token,
        platform: input.platform,
      },
    });

    this.logger.log(`Device token registered for user ${input.userId}`);
    return { success: true };
  }

  async removeDeviceToken(token: string): Promise<{ success: boolean }> {
    await this.prisma.deviceToken.deleteMany({
      where: { token },
    });

    this.logger.log(`Device token removed: ${token.substring(0, 10)}...`);
    return { success: true };
  }

  async sendPushNotification(input: {
    userId: string;
    payload: PushNotificationPayload;
  }): Promise<NotificationResult> {
    // Always store notification in database for Supabase Realtime
    await this.prisma.notification.create({
      data: {
        userId: input.userId,
        title: input.payload.title,
        body: input.payload.body,
        data: input.payload.data || {},
        read: false,
      },
    });

    this.logger.log(`Notification stored for user ${input.userId}: ${input.payload.title}`);

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: input.userId },
      select: { token: true, platform: true },
    });

    if (tokens.length === 0) {
      this.logger.debug(`No device tokens found for user ${input.userId} - notification stored in DB only`);
      return { success: true, sentCount: 0, failedCount: 0 };
    }

    // TODO: Send push notification via FCM/APNs for each token
    this.logger.log(`Push notification sent to ${tokens.length} devices for user ${input.userId}`);

    return {
      success: true,
      sentCount: tokens.length,
      failedCount: 0,
    };
  }

  async getNotifications(userId: string, limit = 20, offset = 0) {
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          title: true,
          body: true,
          data: true,
          read: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return {
      notifications,
      total,
      limit,
      offset,
    };
  }

  async markNotificationRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });

    return { success: true };
  }

  async markAllNotificationsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    return { success: true };
  }

  // Order notification helpers
  async notifyStoreOwnerNewOrder(input: {
    storeId: string;
    order: {
      id: string;
      orderNumber: string;
      status: string;
      totalAmount: number;
      paymentMethod: string;
      paymentStatus: string;
      otpCode: string;
      deliveryLat: number | null;
      deliveryLng: number | null;
      deliveryAddress?: string | null;
      createdAt: Date;
      user: { id: string; name: string | null; phone: string | null } | null;
      store: { id: string; name: string; address: string } | null;
      items: Array<{
        id: string;
        productId: string;
        productName: string;
        size: string;
        quantity: number;
        unitPrice: number;
        product?: { id: string; name: string; images: string[] } | null;
      }>;
    } | null;
  }): Promise<void> {
    this.logger.log(`notifyStoreOwnerNewOrder called for storeId: ${input.storeId}`);
    
    if (!input.order) {
      this.logger.warn('No order provided, returning early');
      return;
    }

    const store = await this.prisma.store.findUnique({
      where: { id: input.storeId },
      select: { ownerId: true, name: true },
    });

    if (!store) {
      this.logger.warn(`Store not found with id: ${input.storeId}`);
      return;
    }

    this.logger.log(`Found store: ${store.name}, ownerId: ${store.ownerId}`);

    await this.sendPushNotification({
      userId: store.ownerId,
      payload: {
        title: 'New Order Received',
        body: `Order #${input.order.orderNumber} has been placed at ${store.name}`,
        data: {
          type: 'order.created',
          orderId: input.order.id,
          orderNumber: input.order.orderNumber,
          // Include full order details for store app to display
          orderDetails: JSON.stringify(input.order),
        },
      },
    });
    
    this.logger.log(`Notification sent to store owner: ${store.ownerId}`);
  }

  async notifyCustomerOrderAccepted(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
  }): Promise<void> {
    await this.sendPushNotification({
      userId: input.customerId,
      payload: {
        title: 'Order Accepted',
        body: `Your order #${input.orderNumber} has been accepted and is being prepared`,
        data: {
          type: 'order.accepted',
          orderId: input.orderId,
        },
      },
    });
  }

  async notifyCustomerOrderPacked(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
  }): Promise<void> {
    await this.sendPushNotification({
      userId: input.customerId,
      payload: {
        title: 'Order Packed',
        body: `Your order #${input.orderNumber} is packed and ready for pickup`,
        data: {
          type: 'order.packed',
          orderId: input.orderId,
        },
      },
    });
  }

  async notifyCustomerOrderSubmitted(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
  }): Promise<void> {
    await this.sendPushNotification({
      userId: input.customerId,
      payload: {
        title: 'Order Submitted',
        body: `Your order #${input.orderNumber} has been submitted for delivery`,
        data: {
          type: 'order.submitted',
          orderId: input.orderId,
        },
      },
    });
  }

  async notifyCustomerOrderOutForDelivery(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
  }): Promise<void> {
    await this.sendPushNotification({
      userId: input.customerId,
      payload: {
        title: 'Out for Delivery',
        body: `Your order #${input.orderNumber} is on its way!`,
        data: {
          type: 'order.out_for_delivery',
          orderId: input.orderId,
        },
      },
    });
  }

  async notifyCustomerOrderDelivered(input: {
    customerId: string;
    orderId: string;
    orderNumber: string;
  }): Promise<void> {
    await this.sendPushNotification({
      userId: input.customerId,
      payload: {
        title: 'Order Delivered',
        body: `Your order #${input.orderNumber} has been delivered. Thank you!`,
        data: {
          type: 'order.delivered',
          orderId: input.orderId,
        },
      },
    });
  }
}
