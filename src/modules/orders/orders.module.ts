import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PackingTimerService } from './packing-timer.service';
import { TrackingModule } from '../tracking/tracking.module';
import { RidersModule } from '../riders/riders.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TrackingModule, RidersModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [OrdersService, PackingTimerService],
})
export class OrdersModule {}
