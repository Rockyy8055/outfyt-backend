import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { IsString, IsOptional, IsNumber, IsBoolean, IsEnum, IsBooleanString, IsNumberString, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

type AuthedRequest = {
  user: { userId: string; role: string };
};

// ==================== DTOs ====================

class OrderFilterDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  riderId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

class UpdateOrderStatusDto {
  @IsString()
  status!: string;
}

class CancelOrderDto {
  @IsString()
  reason!: string;
}

class RefundDto {
  @IsNumber()
  @Min(1)
  amount!: number;
}

class UserFilterDto {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsBooleanString()
  isBlocked?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

class StoreFilterDto {
  @IsOptional()
  @IsBooleanString()
  isApproved?: string;

  @IsOptional()
  @IsBooleanString()
  isDisabled?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

class RejectStoreDto {
  @IsString()
  reason!: string;
}

class RiderFilterDto {
  @IsOptional()
  @IsBooleanString()
  isBlocked?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

class SuspendRiderDto {
  @IsString()
  reason!: string;
}

class TicketFilterDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

class AssignTicketDto {
  @IsString()
  adminId!: string;
}

class UpdateTicketStatusDto {
  @IsString()
  status!: string;
}

class TicketReplyDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

class SearchDto {
  @IsString()
  q!: string;
}

class TransactionFilterDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

// ==================== CONTROLLER ====================

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ==================== ORDER MANAGEMENT ====================

  @Get('orders')
  async getOrders(@Query() filters: OrderFilterDto) {
    return this.adminService.getOrders({
      ...filters,
      page: filters.page ? parseInt(filters.page, 10) : undefined,
      limit: filters.limit ? parseInt(filters.limit, 10) : undefined,
    });
  }

  @Get('orders/:id')
  async getOrderById(@Param('id') id: string) {
    return this.adminService.getOrderById(id);
  }

  @Put('orders/:id/status')
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.updateOrderStatus(id, dto.status, req.user.userId);
  }

  @Post('orders/:id/cancel')
  async cancelOrder(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.cancelOrder(id, dto.reason, req.user.userId);
  }

  @Post('orders/:id/refund')
  async issueRefund(
    @Param('id') id: string,
    @Body() dto: RefundDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.issueRefund(id, dto.amount, req.user.userId);
  }

  // ==================== USER MANAGEMENT ====================

  @Get('users')
  async getUsers(@Query() filters: UserFilterDto) {
    return this.adminService.getUsers({
      ...filters,
      isBlocked: filters.isBlocked ? filters.isBlocked === 'true' : undefined,
      page: filters.page ? parseInt(filters.page, 10) : undefined,
      limit: filters.limit ? parseInt(filters.limit, 10) : undefined,
    });
  }

  @Put('users/:id/block')
  async blockUser(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.adminService.blockUser(id, req.user.userId);
  }

  @Put('users/:id/unblock')
  async unblockUser(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.adminService.unblockUser(id, req.user.userId);
  }

  // ==================== STORE MANAGEMENT ====================

  @Get('stores')
  async getStores(@Query() filters: StoreFilterDto) {
    return this.adminService.getStores({
      ...filters,
      isApproved: filters.isApproved ? filters.isApproved === 'true' : undefined,
      isDisabled: filters.isDisabled ? filters.isDisabled === 'true' : undefined,
      page: filters.page ? parseInt(filters.page, 10) : undefined,
      limit: filters.limit ? parseInt(filters.limit, 10) : undefined,
    });
  }

  @Get('stores/:id')
  async getStoreById(@Param('id') id: string) {
    return this.adminService.getStoreById(id);
  }

  @Put('stores/:id/approve')
  async approveStore(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.adminService.approveStore(id, req.user.userId);
  }

  @Put('stores/:id/reject')
  async rejectStore(
    @Param('id') id: string,
    @Body() dto: RejectStoreDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.rejectStore(id, dto.reason, req.user.userId);
  }

  @Put('stores/:id/disable')
  async disableStore(
    @Param('id') id: string,
    @Body() dto: RejectStoreDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.disableStore(id, dto.reason, req.user.userId);
  }

  // ==================== RIDER MANAGEMENT ====================

  @Get('riders')
  async getRiders(@Query() filters: RiderFilterDto) {
    return this.adminService.getRiders({
      ...filters,
      isBlocked: filters.isBlocked ? filters.isBlocked === 'true' : undefined,
      page: filters.page ? parseInt(filters.page, 10) : undefined,
      limit: filters.limit ? parseInt(filters.limit, 10) : undefined,
    });
  }

  @Put('riders/:id/approve')
  async approveRider(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.adminService.approveRider(id, req.user.userId);
  }

  @Put('riders/:id/suspend')
  async suspendRider(
    @Param('id') id: string,
    @Body() dto: SuspendRiderDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.suspendRider(id, dto.reason, req.user.userId);
  }

  // ==================== TICKET MANAGEMENT ====================

  @Get('tickets')
  async getTickets(@Query() filters: TicketFilterDto) {
    return this.adminService.getTickets({
      ...filters,
      page: filters.page ? parseInt(filters.page, 10) : undefined,
      limit: filters.limit ? parseInt(filters.limit, 10) : undefined,
    });
  }

  @Get('tickets/:id')
  async getTicketById(@Param('id') id: string) {
    return this.adminService.getTicketById(id);
  }

  @Put('tickets/:id/assign')
  async assignTicket(
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.assignTicket(id, req.user.userId, dto.adminId);
  }

  @Put('tickets/:id/status')
  async updateTicketStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTicketStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.updateTicketStatus(id, dto.status, req.user.userId);
  }

  @Post('tickets/:id/reply')
  async replyToTicket(
    @Param('id') id: string,
    @Body() dto: TicketReplyDto,
    @Req() req: AuthedRequest,
  ) {
    return this.adminService.replyToTicket(id, req.user.userId, dto.message, dto.isInternal || false);
  }

  // ==================== ANALYTICS ====================

  @Get('analytics')
  async getAnalytics() {
    return this.adminService.getAnalytics();
  }

  // ==================== GLOBAL SEARCH ====================

  @Get('search')
  async globalSearch(@Query() query: SearchDto) {
    return this.adminService.globalSearch(query.q);
  }

  // ==================== TRANSACTIONS ====================

  @Get('transactions')
  async getTransactions(@Query() filters: TransactionFilterDto) {
    return this.adminService.getTransactions({
      ...filters,
      page: filters.page ? parseInt(filters.page, 10) : undefined,
      limit: filters.limit ? parseInt(filters.limit, 10) : undefined,
    });
  }
}
