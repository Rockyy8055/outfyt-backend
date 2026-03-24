import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SupportController } from './support.controller';
import { AdminService } from './admin.service';
import { DirectDbService } from './direct-db.service';
import { AdminGuard } from './admin.guard';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController, SupportController],
  providers: [AdminService, DirectDbService, AdminGuard],
  exports: [AdminService, DirectDbService],
})
export class AdminModule {}
