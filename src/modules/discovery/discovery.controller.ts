import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  UseGuards,
  Req,
  Body,
} from '@nestjs/common';
import { IsNumberString, IsOptional, IsString, IsNumber } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/optional-jwt-auth.guard';
import { DiscoveryService } from './discovery.service';

type AuthedRequest = {
  user: { userId: string; role: string };
};

class LocationQueryDto {
  @IsNumberString()
  lat!: string;

  @IsNumberString()
  lng!: string;

  @IsOptional()
  @IsNumberString()
  radius?: string;
}

class SearchQueryDto {
  @IsString()
  q!: string;

  @IsOptional()
  @IsNumberString()
  lat?: string;

  @IsOptional()
  @IsNumberString()
  lng?: string;
}

class FilterQueryDto {
  @IsString()
  filter!: string;

  @IsNumberString()
  lat!: string;

  @IsNumberString()
  lng!: string;
}

class ActivityDto {
  @IsString()
  activityType!: 'VIEW' | 'CLICK' | 'ORDER' | 'SEARCH';

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  searchQuery?: string;
}

@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  // ==================== HOME FEED ====================
  @Get('home-feed')
  @UseGuards(OptionalJwtAuthGuard)
  async getHomeFeed(
    @Req() req: AuthedRequest,
    @Query() query: LocationQueryDto,
  ) {
    const userId = req.user?.userId || 'anonymous';
    const lat = Number(query.lat);
    const lng = Number(query.lng);

    return this.discoveryService.getHomeFeed(userId, lat, lng);
  }

  // ==================== NEARBY STORES ====================
  @Get('nearby')
  async getNearbyStores(@Query() query: LocationQueryDto) {
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    const radius = query.radius ? Number(query.radius) : 30;

    return this.discoveryService.getNearbyStores(lat, lng, radius);
  }

  // ==================== RECOMMENDED STORES ====================
  @Get('recommended')
  @UseGuards(JwtAuthGuard)
  async getRecommendedStores(
    @Req() req: AuthedRequest,
    @Query() query: LocationQueryDto,
  ) {
    const lat = Number(query.lat);
    const lng = Number(query.lng);

    return this.discoveryService.getRecommendedStores(req.user.userId, lat, lng);
  }

  // ==================== CATEGORIES ====================
  @Get('categories')
  async getCategories() {
    return this.discoveryService.getCategories();
  }

  // ==================== FILTERS ====================
  @Get('filters')
  async getFilters() {
    return this.discoveryService.getFilters();
  }

  // ==================== FILTERED STORES ====================
  @Get('stores/filter')
  async getFilteredStores(@Query() query: FilterQueryDto) {
    const lat = Number(query.lat);
    const lng = Number(query.lng);

    return this.discoveryService.getFilteredStores(query.filter, lat, lng);
  }

  // ==================== SEARCH ====================
  @Get('search')
  @UseGuards(OptionalJwtAuthGuard)
  async search(
    @Req() req: AuthedRequest,
    @Query() query: SearchQueryDto,
  ) {
    const lat = query.lat ? Number(query.lat) : undefined;
    const lng = query.lng ? Number(query.lng) : undefined;

    const result = await this.discoveryService.search(query.q, lat, lng);

    // Track search activity if user is logged in
    if (req.user?.userId) {
      await this.discoveryService.trackActivity(req.user.userId, 'SEARCH', {
        searchQuery: query.q,
      });
    }

    return result;
  }

  // ==================== DISCOVER ====================
  @Get('discover')
  @UseGuards(OptionalJwtAuthGuard)
  async getDiscover(
    @Req() req: AuthedRequest,
    @Query() query: LocationQueryDto,
  ) {
    const userId = req.user?.userId || 'anonymous';
    const lat = query.lat ? Number(query.lat) : undefined;
    const lng = query.lng ? Number(query.lng) : undefined;

    return this.discoveryService.getDiscover(userId, lat, lng);
  }

  // ==================== STORE PRODUCTS ====================
  @Get('stores/:storeId/products')
  async getStoreProducts(
    @Param('storeId') storeId: string,
    @Query('filter') filter?: string,
  ) {
    return this.discoveryService.getStoreProducts(storeId, filter);
  }

  // ==================== TRACK ACTIVITY ====================
  @Post('activity')
  @UseGuards(JwtAuthGuard)
  async trackActivity(
    @Req() req: AuthedRequest,
    @Body() dto: ActivityDto,
  ) {
    await this.discoveryService.trackActivity(
      req.user.userId,
      dto.activityType,
      {
        storeId: dto.storeId,
        productId: dto.productId,
        searchQuery: dto.searchQuery,
      },
    );

    return { success: true };
  }
}
