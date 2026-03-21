import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as XLSX from 'xlsx';
import { Decimal } from '@prisma/client/runtime/library';

export interface BulkUploadResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
  products: Array<{ id: string; name: string }>;
}

export interface ProductWithInventory {
  id: string;
  name: string;
  price: number;
  images: string[];
  storeId: string;
  inventory?: Array<{ size: string; stock: number }>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(storeId: string, data: {
    name: string;
    price: number;
    images?: string[];
    category?: string;
    sizes?: Array<{ size: string; stock: number }>;
  }): Promise<ProductWithInventory> {
    const product = await this.prisma.product.create({
      data: {
        name: data.name,
        price: data.price,
        images: data.images || [],
        storeId,
        category: data.category,
      },
      include: { inventory: true },
    });

    // Create inventory entries if sizes provided
    if (data.sizes && data.sizes.length > 0) {
      await this.prisma.inventory.createMany({
        data: data.sizes.map(s => ({
          productId: product.id,
          size: s.size,
          stock: s.stock,
        })),
      });
    }

    return this.findById(product.id) as Promise<ProductWithInventory>;
  }

  async findById(id: string): Promise<ProductWithInventory | null> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { inventory: true },
    });

    if (!product) return null;

    return {
      id: product.id,
      name: product.name,
      price: product.price,
      images: product.images,
      storeId: product.storeId,
      inventory: product.inventory.map(i => ({ size: i.size, stock: i.stock })),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  async findByStore(storeId: string, page = 1, limit = 20): Promise<{ products: ProductWithInventory[]; total: number }> {
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: { storeId },
        include: { inventory: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where: { storeId } }),
    ]);

    return {
      products: products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        images: p.images,
        storeId: p.storeId,
        inventory: p.inventory.map(i => ({ size: i.size, stock: i.stock })),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      total,
    };
  }

  async update(id: string, storeId: string, data: {
    name?: string;
    price?: number;
    images?: string[];
    category?: string;
    sizes?: Array<{ size: string; stock: number }>;
  }): Promise<ProductWithInventory> {
    // Verify ownership
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { storeId: true },
    });

    if (!existing) throw new NotFoundException('Product not found');
    if (existing.storeId !== storeId) throw new ForbiddenException('Not authorized to update this product');

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        name: data.name,
        price: data.price,
        images: data.images,
        category: data.category,
      },
      include: { inventory: true },
    });

    // Update inventory if provided
    if (data.sizes) {
      // Delete existing inventory
      await this.prisma.inventory.deleteMany({
        where: { productId: id },
      });

      // Create new inventory
      if (data.sizes.length > 0) {
        await this.prisma.inventory.createMany({
          data: data.sizes.map(s => ({
            productId: id,
            size: s.size,
            stock: s.stock,
          })),
        });
      }
    }

    return this.findById(id) as Promise<ProductWithInventory>;
  }

  async delete(id: string, storeId: string): Promise<void> {
    // Verify ownership
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { storeId: true },
    });

    if (!existing) throw new NotFoundException('Product not found');
    if (existing.storeId !== storeId) throw new ForbiddenException('Not authorized to delete this product');

    await this.prisma.inventory.deleteMany({
      where: { productId: id },
    });

    await this.prisma.product.delete({
      where: { id },
    });
  }

  async bulkUpload(
    storeId: string,
    file: Express.Multer.File,
    imageMap?: Map<string, string>,
  ): Promise<BulkUploadResult> {
    const result: BulkUploadResult = {
      success: 0,
      failed: 0,
      errors: [],
      products: [],
    };

    let rows: Array<Record<string, any>> = [];

    // Parse CSV or Excel
    if (file.originalname.endsWith('.csv')) {
      rows = this.parseCSV(file.buffer.toString('utf-8'));
    } else if (file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
      rows = this.parseExcel(file.buffer);
    } else {
      throw new BadRequestException('Unsupported file format. Use CSV or Excel (.xlsx, .xls)');
    }

    // Validate and create products
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because row 1 is header

      try {
        // Validate required fields
        const name = row['name']?.toString().trim();
        const priceStr = row['price']?.toString().trim();
        const price = parseFloat(priceStr);

        if (!name) {
          result.errors.push({ row: rowNum, message: 'Name is required' });
          result.failed++;
          continue;
        }

        if (!priceStr || isNaN(price) || price <= 0) {
          result.errors.push({ row: rowNum, message: 'Valid price is required (must be a positive number)' });
          result.failed++;
          continue;
        }

        // Optional fields
        const category = row['category']?.toString().trim() || undefined;
        const color = row['color']?.toString().trim() || undefined;
        const sizeStr = row['size']?.toString().trim() || undefined;
        const stockStr = row['stock']?.toString().trim() || '0';
        const stock = parseInt(stockStr, 10) || 0;

        // Handle images
        let images: string[] = [];
        const imageUrl = row['image_url']?.toString().trim();
        const imageName = row['image_name']?.toString().trim();

        if (imageUrl) {
          images = [imageUrl];
        } else if (imageName && imageMap?.has(imageName)) {
          images = [imageMap.get(imageName)!];
        }

        // Create product
        const product = await this.prisma.product.create({
          data: {
            name,
            price,
            images,
            storeId,
            category,
            color,
          },
        });

        // Create inventory if size specified
        if (sizeStr) {
          await this.prisma.inventory.create({
            data: {
              productId: product.id,
              size: sizeStr,
              stock,
            },
          });
        }

        result.success++;
        result.products.push({ id: product.id, name: product.name });
      } catch (error: any) {
        result.errors.push({
          row: rowNum,
          message: error?.message || 'Failed to create product',
        });
        result.failed++;
      }
    }

    return result;
  }

  private parseCSV(content: string): Array<Record<string, any>> {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new BadRequestException('CSV file must have header and at least one data row');
    }

    const headers = this.parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const rows: Array<Record<string, any>> = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      const row: Record<string, any> = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index]?.trim() || '';
      });
      
      rows.push(row);
    }

    return rows;
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current);
    return result;
  }

  private parseExcel(buffer: Buffer): Array<Record<string, any>> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

    // Normalize headers to lowercase
    return data.map(row => {
      const normalized: Record<string, any> = {};
      Object.entries(row).forEach(([key, value]) => {
        normalized[key.toLowerCase().trim()] = value;
      });
      return normalized;
    });
  }
}
