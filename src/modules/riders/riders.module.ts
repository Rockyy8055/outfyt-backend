import { Module } from '@nestjs/common';
import { RidersService } from './riders.service';

@Module({
  providers: [RidersService],
  exports: [RidersService],
})
export class RidersModule {}
