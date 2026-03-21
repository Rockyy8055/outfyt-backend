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
        distance: number;
      }>
    >`
      SELECT *,
      (
        6371 * acos(
          cos(radians(${input.lat}))
          * cos(radians("latitude"))
          * cos(radians("longitude") - radians(${input.lng}))
          + sin(radians(${input.lat}))
          * sin(radians("latitude"))
        )
      ) AS distance
      FROM "Store"
      HAVING distance < ${radiusKm}
      ORDER BY distance;
    `;

    return stores;
  }
}
