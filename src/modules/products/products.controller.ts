import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Inject,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsNumber, IsNumberString, IsOptional, IsString, Min, IsArray, IsPositive, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { ProductsService, BulkUploadResult, ProductWithInventory } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';

type AuthedRequest = {
  user: { userId: string; role: string };
};

class CreateProductDto {
  @IsString()
  name!: string;

  @IsNumber()
  @IsPositive()
  price!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeStockDto)
  sizes?: SizeStockDto[];
}

class SizeStockDto {
  @IsString()
  size!: string;

  @IsNumber()
  @Min(0)
  stock!: number;
}

class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeStockDto)
  sizes?: SizeStockDto[];
}

class ProductQueryDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STORE')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Query() query: ProductQueryDto,
  ): Promise<{ products: ProductWithInventory[]; total: number; page: number; limit: number }> {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    
    const storeId = await this.getStoreId(req.user.userId);
    const result = await this.productsService.findByStore(storeId, page, limit);
    
    return {
      ...result,
      page,
      limit,
    };
  }

  @Get(':id')
  async get(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<ProductWithInventory> {
    const storeId = await this.getStoreId(req.user.userId);
    const product = await this.productsService.findById(id);
    
    if (!product) {
      throw new Error('Product not found');
    }
    
    if (product.storeId !== storeId) {
      throw new Error('Not authorized to access this product');
    }
    
    return product;
  }

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() dto: CreateProductDto,
  ): Promise<ProductWithInventory> {
    const storeId = await this.getStoreId(req.user.userId);
    
    return this.productsService.create(storeId, {
      name: dto.name,
      price: dto.price,
      images: dto.images,
      category: dto.category,
      sizes: dto.sizes,
    });
  }

  @Put(':id')
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductWithInventory> {
    const storeId = await this.getStoreId(req.user.userId);
    
    return this.productsService.update(id, storeId, {
      name: dto.name,
      price: dto.price,
      images: dto.images,
      category: dto.category,
      sizes: dto.sizes,
    });
  }

  @Delete(':id')
  async delete(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const storeId = await this.getStoreId(req.user.userId);
    
    await this.productsService.delete(id, storeId);
    
    return { success: true };
  }

  @Post('bulk-upload')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUpload(
    @Req() req: AuthedRequest,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<BulkUploadResult> {
    if (!file) {
      throw new Error('No file uploaded');
    }
    
    const storeId = await this.getStoreId(req.user.userId);
    
    return this.productsService.bulkUpload(storeId, file);
  }

  private async getStoreId(userId: string): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    
    if (!store) {
      throw new Error('Store not found for this user');
    }
    
    return store.id;
  }
}
