import { Controller, Post, Body, UseGuards, Get, Put, Req, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsString, IsOptional, Length, IsNumber, IsNumberString } from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { RolesGuard } from '../roles.guard';
import { Roles } from '../roles.decorator';

type AuthedRequest = {
  user: { userId: string; role: string };
};

class SendOtpDto {
  @IsString()
  phone!: string;
}

class VerifyOtpDto {
  @IsString()
  phone!: string;

  @IsString()
  @Length(4, 6)
  otp!: string;
}

class UpdateStoreDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  gstNumber?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  phone?: string;
}

// In-memory OTP store (in production, use Redis)
const otpStore = new Map<string, { otp: string; expiresAt: Date }>();

@Controller('web')
export class WebAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // Send OTP to phone number
  @Post('auth/send-otp')
  async sendOtp(@Body() dto: SendOtpDto): Promise<{ success: boolean; message: string }> {
    const phone = dto.phone.trim();
    
    // Check if user exists with STORE role
    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, role: true, name: true },
    });

    if (!user || user.role !== 'STORE') {
      // For security, don't reveal if user exists
      return { success: true, message: 'If an account exists, OTP will be sent' };
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP
    otpStore.set(phone, { otp, expiresAt });

    // In production, send SMS via Twilio, MSG91, etc.
    // For development, log the OTP
    console.log(`[DEV] OTP for ${phone}: ${otp}`);

    return { success: true, message: 'OTP sent successfully' };
  }

  // Verify OTP and return JWT
  @Post('auth/verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto): Promise<{ success: boolean; accessToken?: string; user?: any; error?: string }> {
    const phone = dto.phone.trim();
    const otp = dto.otp.trim();

    // Check stored OTP
    const stored = otpStore.get(phone);
    
    if (!stored) {
      return { success: false, error: 'OTP not found. Please request a new one.' };
    }

    if (new Date() > stored.expiresAt) {
      otpStore.delete(phone);
      return { success: false, error: 'OTP expired. Please request a new one.' };
    }

    if (stored.otp !== otp) {
      return { success: false, error: 'Invalid OTP' };
    }

    // Clear used OTP
    otpStore.delete(phone);

    // Get user
    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, name: true, phone: true, email: true, role: true },
    });

    if (!user || user.role !== 'STORE') {
      return { success: false, error: 'Account not found' };
    }

    // Get store info
    const store = await this.prisma.store.findUnique({
      where: { ownerId: user.id },
      select: { id: true, name: true, address: true },
    });

    // Generate JWT
    const accessToken = await this.jwtService.signAsync({
      userId: user.id,
      role: user.role,
    });

    return {
      success: true,
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        store: store ? { id: store.id, name: store.name, address: store.address } : null,
      },
    };
  }

  // Get current store profile
  @Get('store/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STORE')
  async getStoreProfile(@Req() req: AuthedRequest): Promise<any> {
    const store = await this.prisma.store.findUnique({
      where: { ownerId: req.user.userId },
      include: {
        owner: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return {
      id: store.id,
      name: store.name,
      address: store.address,
      latitude: store.latitude,
      longitude: store.longitude,
      gstNumber: store.gstNumber,
      phone: store.phone,
      owner: store.owner,
    };
  }

  // Update store profile
  @Put('store/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STORE')
  async updateStoreProfile(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateStoreDto,
  ): Promise<any> {
    const existingStore = await this.prisma.store.findUnique({
      where: { ownerId: req.user.userId },
    });

    if (!existingStore) {
      throw new NotFoundException('Store not found');
    }

    const store = await this.prisma.store.update({
      where: { id: existingStore.id },
      data: {
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        gstNumber: dto.gstNumber,
        phone: dto.phone,
      },
      include: {
        owner: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    return {
      id: store.id,
      name: store.name,
      address: store.address,
      latitude: store.latitude,
      longitude: store.longitude,
      gstNumber: store.gstNumber,
      phone: store.phone,
      owner: store.owner,
    };
  }

  // Get store statistics
  @Get('store/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('STORE')
  async getStoreStats(@Req() req: AuthedRequest): Promise<any> {
    const store = await this.prisma.store.findUnique({
      where: { ownerId: req.user.userId },
      select: { id: true },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const [totalProducts, totalOrders, pendingOrders, completedOrders] = await Promise.all([
      this.prisma.product.count({ where: { storeId: store.id } }),
      this.prisma.order.count({ where: { storeId: store.id } }),
      this.prisma.order.count({ where: { storeId: store.id, status: 'PENDING' } }),
      this.prisma.order.count({ where: { storeId: store.id, status: 'DELIVERED' } }),
    ]);

    return {
      totalProducts,
      totalOrders,
      pendingOrders,
      completedOrders,
    };
  }
}
