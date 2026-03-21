import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../tracking/tracking.gateway';

export interface PackingTimerState {
  orderId: string;
  storeId: string;
  startedAt: number;
  durationMs: number;
  expiresAt: number;
  isExtended: boolean;
}

@Injectable()
export class PackingTimerService implements OnModuleDestroy {
  private readonly logger = new Logger(PackingTimerService.name);
  private readonly defaultDurationMs = 5 * 60 * 1000; // 5 minutes
  private readonly maxExtensionMs = 5 * 60 * 1000; // 5 additional minutes max
  private readonly timers = new Map<string, { state: PackingTimerState; timeout: NodeJS.Timeout }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly trackingGateway: TrackingGateway,
  ) {}

  onModuleDestroy() {
    // Clear all timers on module destroy
    for (const [orderId, { timeout }] of this.timers) {
      clearTimeout(timeout);
    }
    this.timers.clear();
  }

  async startPackingTimer(input: {
    orderId: string;
    storeId: string;
    durationMs?: number;
  }): Promise<PackingTimerState> {
    const durationMs = input.durationMs || this.defaultDurationMs;
    const startedAt = Date.now();
    const expiresAt = startedAt + durationMs;

    const state: PackingTimerState = {
      orderId: input.orderId,
      storeId: input.storeId,
      startedAt,
      durationMs,
      expiresAt,
      isExtended: false,
    };

    // Clear existing timer if any
    const existing = this.timers.get(input.orderId);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    // Set timeout for timer expiration
    const timeout = setTimeout(() => {
      this.handleTimerExpiration(input.orderId);
    }, durationMs);

    this.timers.set(input.orderId, { state, timeout });

    this.logger.log(`Started packing timer for order ${input.orderId}, expires in ${durationMs}ms`);

    // Notify store about timer start
    this.trackingGateway.emitToStore(input.storeId, 'packing_timer_started', {
      orderId: input.orderId,
      durationMs,
      expiresAt,
    });

    return state;
  }

  async extendPackingTimer(input: {
    orderId: string;
    additionalMs?: number;
  }): Promise<PackingTimerState | null> {
    const existing = this.timers.get(input.orderId);
    if (!existing) {
      return null;
    }

    const additionalMs = Math.min(
      input.additionalMs || this.defaultDurationMs,
      this.maxExtensionMs,
    );

    const newExpiresAt = Date.now() + additionalMs;
    const newState: PackingTimerState = {
      ...existing.state,
      expiresAt: newExpiresAt,
      durationMs: existing.state.durationMs + additionalMs,
      isExtended: true,
    };

    // Clear old timeout and set new one
    clearTimeout(existing.timeout);
    const timeout = setTimeout(() => {
      this.handleTimerExpiration(input.orderId);
    }, additionalMs);

    this.timers.set(input.orderId, { state: newState, timeout });

    this.logger.log(`Extended packing timer for order ${input.orderId} by ${additionalMs}ms`);

    // Notify about extension
    this.trackingGateway.emitToStore(existing.state.storeId, 'packing_timer_extended', {
      orderId: input.orderId,
      additionalMs,
      expiresAt: newExpiresAt,
    });

    this.trackingGateway.emitToOrder(input.orderId, 'packing_timer_extended', {
      orderId: input.orderId,
      additionalMs,
      expiresAt: newExpiresAt,
    });

    return newState;
  }

  async completePackingEarly(input: { orderId: string }): Promise<void> {
    const existing = this.timers.get(input.orderId);
    if (!existing) return;

    clearTimeout(existing.timeout);
    this.timers.delete(input.orderId);

    this.logger.log(`Packing completed early for order ${input.orderId}`);

    this.trackingGateway.emitToStore(existing.state.storeId, 'packing_timer_completed', {
      orderId: input.orderId,
      completedEarly: true,
    });
  }

  async getTimerState(orderId: string): Promise<PackingTimerState | null> {
    const existing = this.timers.get(orderId);
    return existing ? existing.state : null;
  }

  async cancelTimer(orderId: string): Promise<void> {
    const existing = this.timers.get(orderId);
    if (existing) {
      clearTimeout(existing.timeout);
      this.timers.delete(orderId);
      this.logger.log(`Cancelled packing timer for order ${orderId}`);
    }
  }

  private async handleTimerExpiration(orderId: string): Promise<void> {
    const existing = this.timers.get(orderId);
    if (!existing) return;

    // Check if order is still in PACKING status
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, storeId: true },
    });

    if (!order || order.status !== OrderStatus.PACKING) {
      this.logger.debug(`Order ${orderId} no longer in PACKING status, skipping timer handling`);
      this.timers.delete(orderId);
      return;
    }

    // Timer expired - notify store owner
    this.trackingGateway.emitToStore(existing.state.storeId, 'packing_timer_expired', {
      orderId,
      canExtend: !existing.state.isExtended,
    });

    this.logger.warn(`Packing timer expired for order ${orderId}`);
  }
}
