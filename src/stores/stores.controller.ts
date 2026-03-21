import { Controller, Get, Query } from '@nestjs/common';
import { IsNumberString, IsOptional, IsString } from 'class-validator';
import { StoresService } from './stores.service';

class NearbyStoresQueryDto {
  @IsNumberString()
  lat!: string;

  @IsNumberString()
  lng!: string;

  @IsOptional()
  @IsString()
  radiusKm?: string;
}

@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get('nearby')
  async nearby(@Query() query: NearbyStoresQueryDto) {
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    const radiusKm = query.radiusKm ? Number(query.radiusKm) : undefined;

    return this.storesService.findNearby({ lat, lng, radiusKm });
  }
}
