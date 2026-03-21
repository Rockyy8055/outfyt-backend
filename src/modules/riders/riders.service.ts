import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RidersService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertRiderLocation(input: {
    riderId: string;
    orderId: string;
    latitude: number;
    longitude: number;
  }) {
    return this.prisma.riderLocation.upsert({
      where: { id: `${input.riderId}:${input.orderId}` },
      create: {
        id: `${input.riderId}:${input.orderId}`,
        riderId: input.riderId,
        orderId: input.orderId,
        latitude: input.latitude,
        longitude: input.longitude,
      },
      update: {
        latitude: input.latitude,
        longitude: input.longitude,
      },
    });
  }

  async findNearestRider(input: { lat: number; lng: number; maxKm?: number }) {
    const maxKm = input.maxKm ?? 30;

    const riders = await this.prisma.$queryRaw<
      Array<{ riderId: string; latitude: number; longitude: number; distance: number }>
    >`
      SELECT "riderId", "latitude", "longitude",
      (
        6371 * acos(
          cos(radians(${input.lat}))
          * cos(radians("latitude"))
          * cos(radians("longitude") - radians(${input.lng}))
          + sin(radians(${input.lat}))
          * sin(radians("latitude"))
        )
      ) AS distance
      FROM "RiderLocation"
      ORDER BY distance
      LIMIT 1;
    `;

    const nearest = riders[0];
    if (!nearest || nearest.distance > maxKm) return null;

    return nearest;
  }

  async getLiveLocation(input: { riderId: string; orderId: string }) {
    return this.prisma.riderLocation.findFirst({
      where: { riderId: input.riderId, orderId: input.orderId },
    });
  }
}
