import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  async findNearby(input: { lat: number; lng: number; radiusKm?: number }) {
    const radiusKm = input.radiusKm ?? 30;

    const stores = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        address: string;
        ownerId: string;
        rating: number;
        totalOrders: number;
        category: string | null;
        tags: string[];
        distance: number;
      }>
    >`
      SELECT 
        id, name, latitude, longitude, address, "ownerId", rating, "totalOrders", category, tags,
        (
          6371 * acos(
            cos(radians(${input.lat}))
            * cos(radians(latitude))
            * cos(radians(longitude) - radians(${input.lng}))
            + sin(radians(${input.lat}))
            * sin(radians(latitude))
          )
        ) AS distance
      FROM "Store"
      WHERE "isApproved" = true AND "isDisabled" = false
      HAVING distance < ${radiusKm}
      ORDER BY distance
    `;

    // Round distance to 2 decimal places
    return stores.map(s => ({
      ...s,
      distance: Math.round(s.distance * 100) / 100,
    }));
  }

  async findById(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        address: true,
        rating: true,
        totalOrders: true,
        category: true,
        tags: true,
        phone: true,
        gstNumber: true,
        isApproved: true,
        isDisabled: true,
        createdAt: true,
      },
    });

    return store;
  }

  async updateStoreStats(storeId: string, orderCount: number) {
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        totalOrders: { increment: orderCount },
      },
    });
  }

  async getStoreWithProducts(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            price: true,
            images: true,
            category: true,
            rating: true,
            totalSold: true,
            isTrending: true,
            isNew: true,
            inventory: {
              select: { size: true, stock: true },
            },
          },
        },
      },
    });

    return store;
  }
}
