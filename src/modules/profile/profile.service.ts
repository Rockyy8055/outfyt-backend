import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      return null;
    }

    // Get counts
    const [ordersCount, wishlistCount, addresses] = await Promise.all([
      this.prisma.order.count({ where: { userId } }),
      this.prisma.wishlist.count({ where: { userId } }),
      this.getAddresses(userId),
    ]);

    return {
      ...user,
      ordersCount,
      wishlistCount,
      addresses,
    };
  }

  async updateProfile(userId: string, data: { name?: string; phone?: string; email?: string }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
      },
    });

    return user;
  }

  private async getAddresses(userId: string) {
    // For now, return empty array
    // In a real app, you'd have an Address table
    // This is a placeholder for the delivery addresses
    return [];
  }

  async getOrderHistory(userId: string, limit: number = 10, offset: number = 0) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
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
        store: {
          select: { id: true, name: true, address: true },
        },
        items: {
          select: {
            id: true,
            productName: true,
            size: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
    });

    const total = await this.prisma.order.count({ where: { userId } });

    return { orders, total, limit, offset };
  }

  async getStats(userId: string) {
    const [totalOrders, completedOrders, totalSpent, wishlistCount] = await Promise.all([
      this.prisma.order.count({ where: { userId } }),
      this.prisma.order.count({ where: { userId, status: 'DELIVERED' } }),
      this.prisma.order.aggregate({
        where: { userId, status: 'DELIVERED' },
        _sum: { totalAmount: true },
      }),
      this.prisma.wishlist.count({ where: { userId } }),
    ]);

    return {
      totalOrders,
      completedOrders,
      totalSpent: totalSpent._sum.totalAmount || 0,
      wishlistCount,
    };
  }
}
