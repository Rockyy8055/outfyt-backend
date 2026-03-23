import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== ORDER MANAGEMENT ====================

  async getOrders(filters: {
    status?: string;
    storeId?: string;
    customerId?: string;
    riderId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.storeId) {
      where.storeId = filters.storeId;
    }
    if (filters.customerId) {
      where.userId = filters.customerId;
    }
    if (filters.riderId) {
      where.riderId = filters.riderId;
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.createdAt.lte = new Date(filters.endDate);
      }
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, phone: true } },
          store: { select: { id: true, name: true, address: true } },
          rider: { select: { id: true, name: true, phone: true } },
          items: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      success: true,
      data: orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getOrderById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        store: { select: { id: true, name: true, address: true, phone: true } },
        rider: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, images: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return { success: true, data: order };
  }

  async updateOrderStatus(id: string, status: string, adminId: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: status as any },
    });

    // Log admin action
    await this.logAdminAction(adminId, 'UPDATE_ORDER_STATUS', 'Order', id, { status });

    return { success: true, data: updated };
  }

  async cancelOrder(id: string, reason: string, adminId: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
      throw new BadRequestException('Cannot cancel this order');
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        rejectionReason: reason,
      },
    });

    await this.logAdminAction(adminId, 'CANCEL_ORDER', 'Order', id, { reason });

    return { success: true, data: updated };
  }

  async issueRefund(orderId: string, amount: number, adminId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Create refund transaction
    const transaction = await this.prisma.transaction.create({
      data: {
        orderId,
        userId: order.userId,
        amount,
        type: 'REFUND',
        status: 'SUCCESS',
        metadata: { adminId, reason: 'Admin initiated refund' },
      },
    });

    await this.logAdminAction(adminId, 'ISSUE_REFUND', 'Order', orderId, { amount });

    return { success: true, data: transaction };
  }

  // ==================== USER MANAGEMENT ====================

  async getUsers(filters: { role?: string; isBlocked?: boolean; page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.role) {
      where.role = filters.role;
    }
    if (filters.isBlocked !== undefined) {
      where.isBlocked = filters.isBlocked;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          role: true,
          isBlocked: true,
          createdAt: true,
          store: { select: { id: true, name: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async blockUser(id: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === 'ADMIN') {
      throw new ForbiddenException('Cannot block admin users');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isBlocked: true },
    });

    await this.logAdminAction(adminId, 'BLOCK_USER', 'User', id, {});

    return { success: true, data: updated };
  }

  async unblockUser(id: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isBlocked: false },
    });

    await this.logAdminAction(adminId, 'UNBLOCK_USER', 'User', id, {});

    return { success: true, data: updated };
  }

  // ==================== STORE MANAGEMENT ====================

  async getStores(filters: { isApproved?: boolean; isDisabled?: boolean; page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.isApproved !== undefined) {
      where.isApproved = filters.isApproved;
    }
    if (filters.isDisabled !== undefined) {
      where.isDisabled = filters.isDisabled;
    }

    const [stores, total] = await Promise.all([
      this.prisma.store.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, phone: true, email: true } },
          _count: { select: { products: true, orders: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.store.count({ where }),
    ]);

    return {
      success: true,
      data: stores,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ==================== PRODUCT MANAGEMENT ====================

  async getProducts(filters: {
    storeId?: string;
    category?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.storeId) {
      where.storeId = filters.storeId;
    }
    if (filters.category) {
      where.category = { contains: filters.category, mode: 'insensitive' };
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          store: { select: { id: true, name: true, address: true } },
          _count: { select: { inventory: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      success: true,
      data: products,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProductById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        store: { select: { id: true, name: true, address: true, owner: { select: { name: true, phone: true } } } },
        inventory: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return { success: true, data: product };
  }

  async deleteProduct(id: string, adminId: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.delete({ where: { id } });

    await this.logAdminAction(adminId, 'DELETE_PRODUCT', 'Product', id, {});

    return { success: true, message: 'Product deleted successfully' };
  }

  async getStoreById(id: string) {
    const store = await this.prisma.store.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, phone: true, email: true } },
        products: {
          include: { _count: { select: { inventory: true } } },
          take: 50,
        },
        _count: { select: { orders: true } },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return { success: true, data: store };
  }

  async approveStore(id: string, adminId: string) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const updated = await this.prisma.store.update({
      where: { id },
      data: { isApproved: true, isDisabled: false },
    });

    await this.logAdminAction(adminId, 'APPROVE_STORE', 'Store', id, {});

    return { success: true, data: updated };
  }

  async rejectStore(id: string, reason: string, adminId: string) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const updated = await this.prisma.store.update({
      where: { id },
      data: { isApproved: false },
    });

    await this.logAdminAction(adminId, 'REJECT_STORE', 'Store', id, { reason });

    return { success: true, data: updated };
  }

  async disableStore(id: string, reason: string, adminId: string) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const updated = await this.prisma.store.update({
      where: { id },
      data: { isDisabled: true },
    });

    await this.logAdminAction(adminId, 'DISABLE_STORE', 'Store', id, { reason });

    return { success: true, data: updated };
  }

  // ==================== RIDER MANAGEMENT ====================

  async getRiders(filters: { isBlocked?: boolean; page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { role: 'RIDER' };
    if (filters.isBlocked !== undefined) {
      where.isBlocked = filters.isBlocked;
    }

    const [riders, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          isBlocked: true,
          createdAt: true,
          _count: { select: { deliveries: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: riders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async approveRider(id: string, adminId: string) {
    // For riders, approval means unblocking
    return this.unblockUser(id, adminId);
  }

  async suspendRider(id: string, reason: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role !== 'RIDER') {
      throw new NotFoundException('Rider not found');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isBlocked: true },
    });

    await this.logAdminAction(adminId, 'SUSPEND_RIDER', 'User', id, { reason });

    return { success: true, data: updated };
  }

  // ==================== TICKET MANAGEMENT ====================

  async getTickets(filters: {
    status?: string;
    type?: string;
    assignedTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.assignedTo) {
      where.assignedTo = filters.assignedTo;
    }

    const [tickets, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, phone: true } },
          assignee: { select: { id: true, name: true } },
          _count: { select: { replies: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      success: true,
      data: tickets,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTicketById(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        assignee: { select: { id: true, name: true } },
        replies: {
          include: { user: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return { success: true, data: ticket };
  }

  async assignTicket(id: string, adminId: string, assignedAdminId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        assignedTo: assignedAdminId,
        status: 'IN_PROGRESS',
      },
    });

    await this.logAdminAction(adminId, 'ASSIGN_TICKET', 'Ticket', id, { assignedTo: assignedAdminId });

    return { success: true, data: updated };
  }

  async updateTicketStatus(id: string, status: string, adminId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const updateData: any = { status: status as any };
    if (status === 'RESOLVED' || status === 'CLOSED') {
      updateData.resolvedAt = new Date();
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: updateData,
    });

    await this.logAdminAction(adminId, 'UPDATE_TICKET_STATUS', 'Ticket', id, { status });

    return { success: true, data: updated };
  }

  async replyToTicket(id: string, adminId: string, message: string, isInternal: boolean) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const reply = await this.prisma.ticketReply.create({
      data: {
        ticketId: id,
        userId: adminId,
        message,
        isInternal,
      },
    });

    return { success: true, data: reply };
  }

  // ==================== ANALYTICS ====================

  async getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);
    
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const [
      totalOrders,
      totalRevenue,
      todayOrders,
      todayRevenue,
      activeStores,
      totalStores,
      activeRiders,
      totalRiders,
      totalCustomers,
      pendingOrders,
      deliveredOrders,
      cancelledOrders,
      openTickets,
      recentOrders,
      topStores,
      ordersByStatus,
      revenueLast7Days,
      ordersLast7Days,
    ] = await Promise.all([
      // Total orders
      this.prisma.order.count(),
      
      // Total revenue
      this.prisma.order.aggregate({
        where: { paymentStatus: 'SUCCESS' },
        _sum: { totalAmount: true },
      }),
      
      // Today's orders
      this.prisma.order.count({
        where: { createdAt: { gte: today } },
      }),
      
      // Today's revenue
      this.prisma.order.aggregate({
        where: { paymentStatus: 'SUCCESS', createdAt: { gte: today } },
        _sum: { totalAmount: true },
      }),
      
      // Active stores
      this.prisma.store.count({ where: { isDisabled: false, isApproved: true } }),
      
      // Total stores
      this.prisma.store.count(),
      
      // Active riders
      this.prisma.user.count({ where: { role: 'RIDER', isBlocked: false } }),
      
      // Total riders
      this.prisma.user.count({ where: { role: 'RIDER' } }),
      
      // Total customers
      this.prisma.user.count({ where: { role: 'CUSTOMER' } }),
      
      // Pending orders
      this.prisma.order.count({ where: { status: { in: ['PENDING', 'ACCEPTED', 'PACKING', 'READY'] } } }),
      
      // Delivered orders
      this.prisma.order.count({ where: { status: 'DELIVERED' } }),
      
      // Cancelled orders
      this.prisma.order.count({ where: { status: 'CANCELLED' } }),
      
      // Open tickets
      this.prisma.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      
      // Recent orders (last 10)
      this.prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, phone: true } },
          store: { select: { id: true, name: true } },
          items: { select: { id: true, productName: true, quantity: true, unitPrice: true } },
        },
      }),
      
      // Top stores by orders
      this.prisma.store.findMany({
        take: 5,
        include: {
          owner: { select: { name: true, phone: true } },
          _count: { select: { orders: true, products: true } },
        },
        orderBy: { orders: { _count: 'desc' } },
      }),
      
      // Orders by status
      this.prisma.order.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      
      // Revenue last 7 days
      this.prisma.order.groupBy({
        by: ['createdAt'],
        where: {
          paymentStatus: 'SUCCESS',
          createdAt: { gte: last7Days },
        },
        _sum: { totalAmount: true },
      }),
      
      // Orders last 7 days
      this.prisma.order.groupBy({
        by: ['createdAt'],
        where: { createdAt: { gte: last7Days } },
        _count: { id: true },
      }),
    ]);

    return {
      success: true,
      data: {
        overview: {
          totalOrders,
          totalRevenue: totalRevenue._sum.totalAmount || 0,
          todayOrders,
          todayRevenue: todayRevenue._sum.totalAmount || 0,
          activeStores,
          totalStores,
          activeRiders,
          totalRiders,
          totalCustomers,
          pendingOrders,
          deliveredOrders,
          cancelledOrders,
          openTickets,
        },
        recentOrders: recentOrders.map(order => ({
          id: order.id,
          orderNumber: order.id.slice(0, 8).toUpperCase(),
          status: order.status,
          totalAmount: order.totalAmount,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          createdAt: order.createdAt,
          customer: order.user ? {
            id: order.user.id,
            name: order.user.name,
            phone: order.user.phone,
          } : null,
          store: order.store ? {
            id: order.store.id,
            name: order.store.name,
          } : null,
          items: order.items,
        })),
        topStores: topStores.map(store => ({
          id: store.id,
          name: store.name,
          address: store.address,
          owner: store.owner,
          totalOrders: store._count.orders,
          totalProducts: store._count.products,
        })),
        ordersByStatus: ordersByStatus.reduce((acc, item) => {
          acc[item.status] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
        charts: {
          revenueLast7Days: revenueLast7Days.map(item => ({
            date: item.createdAt,
            revenue: item._sum.totalAmount || 0,
          })),
          ordersLast7Days: ordersLast7Days.map(item => ({
            date: item.createdAt,
            count: item._count.id,
          })),
        },
      },
    };
  }

  async getAnalytics() {
    const [
      totalOrders,
      totalRevenue,
      activeStores,
      activeRiders,
      pendingOrders,
      deliveredOrders,
      openTickets,
    ] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.aggregate({
        where: { paymentStatus: 'SUCCESS' },
        _sum: { totalAmount: true },
      }),
      this.prisma.store.count({ where: { isDisabled: false, isApproved: true } }),
      this.prisma.user.count({ where: { role: 'RIDER', isBlocked: false } }),
      this.prisma.order.count({ where: { status: { in: ['PENDING', 'ACCEPTED', 'PACKING', 'READY'] } } }),
      this.prisma.order.count({ where: { status: 'DELIVERED' } }),
      this.prisma.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    ]);

    // Orders by status
    const ordersByStatus = await this.prisma.order.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    // Revenue by day (last 7 days)
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const revenueByDay = await this.prisma.order.groupBy({
      by: ['createdAt'],
      where: {
        paymentStatus: 'SUCCESS',
        createdAt: { gte: last7Days },
      },
      _sum: { totalAmount: true },
    });

    return {
      success: true,
      data: {
        totalOrders,
        totalRevenue: totalRevenue._sum.totalAmount || 0,
        activeStores,
        activeRiders,
        pendingOrders,
        deliveredOrders,
        openTickets,
        ordersByStatus: ordersByStatus.reduce((acc, item) => {
          acc[item.status] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
      },
    };
  }

  // ==================== GLOBAL SEARCH ====================

  async globalSearch(query: string) {
    if (!query || query.length < 2) {
      return { success: true, data: { orders: [], users: [], stores: [] } };
    }

    const [orders, users, stores] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          OR: [
            { orderNumber: { contains: query, mode: 'insensitive' } },
            { id: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 10,
        include: {
          user: { select: { name: true } },
          store: { select: { name: true } },
        },
      }),
      this.prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 10,
        select: { id: true, name: true, phone: true, email: true, role: true },
      }),
      this.prisma.store.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { address: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 10,
        select: { id: true, name: true, address: true },
      }),
    ]);

    return {
      success: true,
      data: { orders, users, stores },
    };
  }

  // ==================== TRANSACTIONS ====================

  async getTransactions(filters: { type?: string; status?: string; page?: number; limit?: number }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          order: { select: { id: true, orderNumber: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      success: true,
      data: transactions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ==================== HELPER ====================

  private async logAdminAction(
    adminId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: any
  ) {
    // Log to notification table for audit trail
    await this.prisma.notification.create({
      data: {
        userId: adminId,
        title: `Admin Action: ${action}`,
        body: `${entityType} ${entityId}`,
        data: { action, entityType, entityId, metadata, timestamp: new Date().toISOString() },
      },
    });
  }
}
