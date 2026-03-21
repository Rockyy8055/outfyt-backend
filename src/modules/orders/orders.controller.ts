import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { Role } from '../../auth/roles.enum';
import { OrderStatus } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';
import { PackingTimerService } from './packing-timer.service';
import { IsOptional, IsEnum, IsInt, Min, Max, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

class ExtendTimerDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(60000)
  @Max(300000)
  additionalMs?: number; // 1-5 minutes in milliseconds
}

type AuthedRequest = {
  user: { userId: string; role: Role };
};

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly packingTimerService: PackingTimerService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  create(@Req() req: AuthedRequest, @Body() dto: CreateOrderDto) {
    const user = req.user;
    return this.ordersService.createOrder({ userId: user.userId, dto });
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.STORE, Role.RIDER, Role.ADMIN)
  updateStatus(
    @Req() req: AuthedRequest,
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const actor = req.user;
    return this.ordersService.updateStatus({ actor, orderId, dto });
  }

  @Get(':id/tracking')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.STORE, Role.RIDER, Role.ADMIN)
  tracking(@Req() req: AuthedRequest, @Param('id') orderId: string) {
    const actor = req.user;
    return this.ordersService.getTracking({ actor, orderId });
  }

  // Customer endpoints
  @Get('customer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  getCustomerOrders(
    @Req() req: AuthedRequest,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.ordersService.getCustomerOrders({
      userId: req.user.userId,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  // Store owner endpoints
  @Get('store')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.STORE)
  getStoreOrders(
    @Req() req: AuthedRequest,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.ordersService.getStoreOrders({
      ownerId: req.user.userId,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  // Get order details (shared endpoint)
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.STORE, Role.RIDER, Role.ADMIN)
  getOrderDetails(@Req() req: AuthedRequest, @Param('id') orderId: string) {
    return this.ordersService.getOrderDetails({
      actor: req.user,
      orderId,
    });
  }

  // Packing timer endpoints
  @Get(':id/packing-timer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.STORE, Role.ADMIN)
  getPackingTimerStatus(@Param('id') orderId: string) {
    return this.packingTimerService.getTimerState(orderId);
  }

  @Post(':id/packing-timer/extend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.STORE, Role.ADMIN)
  extendPackingTimer(
    @Param('id') orderId: string,
    @Body() dto: ExtendTimerDto,
  ) {
    return this.packingTimerService.extendPackingTimer({
      orderId,
      additionalMs: dto.additionalMs,
    });
  }
}
