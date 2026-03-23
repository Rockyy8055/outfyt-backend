import {
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
  Req,
  Body,
} from '@nestjs/common';
import { IsOptional, IsString, IsNumberString } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProfileService } from './profile.service';

type AuthedRequest = {
  user: { userId: string; role: string };
};

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

class PaginationDto {
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsNumberString()
  offset?: string;
}

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  async getProfile(@Req() req: AuthedRequest) {
    return this.profileService.getProfile(req.user.userId);
  }

  @Put()
  async updateProfile(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(req.user.userId, dto);
  }

  @Get('orders')
  async getOrderHistory(
    @Req() req: AuthedRequest,
    @Query() query: PaginationDto,
  ) {
    const limit = query.limit ? parseInt(query.limit, 10) : 10;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    return this.profileService.getOrderHistory(req.user.userId, limit, offset);
  }

  @Get('stats')
  async getStats(@Req() req: AuthedRequest) {
    return this.profileService.getStats(req.user.userId);
  }
}
