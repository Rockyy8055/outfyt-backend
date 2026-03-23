import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async getWishlist(userId: string) {
    const wishlist = await this.prisma.wishlist.findMany({
      where: { userId },
      include: {
        product: {
          include: {
            store: { select: { id: true, name: true } },
            inventory: { select: { size: true, stock: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return wishlist.map(w => ({
      id: w.id,
      productId: w.productId,
      createdAt: w.createdAt,
      product: {
        id: w.product.id,
        name: w.product.name,
        price: w.product.price,
        images: w.product.images,
        category: w.product.category,
        rating: w.product.rating,
        totalSold: w.product.totalSold,
        isTrending: w.product.isTrending,
        isNew: w.product.isNew,
        store: w.product.store,
        inventory: w.product.inventory,
      },
    }));
  }

  async addToWishlist(userId: string, productId: string) {
    // Check if product exists
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Upsert wishlist item
    const wishlistItem = await this.prisma.wishlist.upsert({
      where: {
        userId_productId: { userId, productId },
      },
      create: { userId, productId },
      update: {}, // No update needed if exists
    });

    return wishlistItem;
  }

  async removeFromWishlist(userId: string, productId: string) {
    await this.prisma.wishlist.delete({
      where: {
        userId_productId: { userId, productId },
      },
    });

    return { success: true };
  }

  async isInWishlist(userId: string, productId: string): Promise<boolean> {
    const item = await this.prisma.wishlist.findUnique({
      where: {
        userId_productId: { userId, productId },
      },
    });

    return !!item;
  }

  async getWishlistCount(userId: string): Promise<number> {
    return this.prisma.wishlist.count({
      where: { userId },
    });
  }
}
