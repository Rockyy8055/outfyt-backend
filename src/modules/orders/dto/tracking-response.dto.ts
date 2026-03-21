import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

export class TrackingStoreDto {
  id!: string;
  name!: string;
  latitude!: number;
  longitude!: number;
  address!: string;
}

export class TrackingRiderDto {
  id!: string;
  name!: string;
  phone!: string;
}

export class TrackingRiderLocationDto {
  latitude!: number;
  longitude!: number;
  updatedAt!: Date;
}

export class TrackingResponseDto {
  orderId!: string;
  orderNumber!: string;
  status!: OrderStatus;
  etaMinutes!: number | null;
  store!: TrackingStoreDto;
  rider!: TrackingRiderDto | null;
  liveRiderLocation!: TrackingRiderLocationDto | null;
  paymentMethod!: PaymentMethod;
  paymentStatus!: PaymentStatus;
}
