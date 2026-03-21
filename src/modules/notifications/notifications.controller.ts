import {
  Body,
  Controller,
  Delete,
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
import { NotificationsService } from './notifications.service';
import { IsString, IsIn, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class RegisterDeviceTokenDto {
  @IsString()
  token!: string;

  @IsString()
  @IsIn(['ios', 'android', 'web'])
  platform!: string;
}

class RemoveDeviceTokenDto {
  @IsString()
  token!: string;
}

class ListNotificationsQueryDto {
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

type AuthedRequest = {
  user: { userId: string; role: Role };
};

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('device-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.STORE, Role.RIDER)
  async registerDeviceToken(
    @Req() req: AuthedRequest,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notificationsService.registerDeviceToken({
      userId: req.user.userId,
      token: dto.token,
      platform: dto.platform,
    });
  }

  @Delete('device-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.STORE, Role.RIDER)
  async removeDeviceToken(@Body() dto: RemoveDeviceTokenDto) {
    return this.notificationsService.removeDeviceToken(dto.token);
  }

  // Notification listing endpoints
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.STORE, Role.RIDER, Role.ADMIN)
  async getNotifications(
    @Req() req: AuthedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.getNotifications(
      req.user.userId,
      query.limit,
      query.offset,
    );
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.STORE, Role.RIDER, Role.ADMIN)
  async markNotificationRead(
    @Req() req: AuthedRequest,
    @Param('id') notificationId: string,
  ) {
    return this.notificationsService.markNotificationRead(
      req.user.userId,
      notificationId,
    );
  }

  @Patch('read-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER, Role.STORE, Role.RIDER, Role.ADMIN)
  async markAllNotificationsRead(@Req() req: AuthedRequest) {
    return this.notificationsService.markAllNotificationsRead(req.user.userId);
  }
}
