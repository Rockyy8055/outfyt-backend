import { Body, Controller, Post, UseGuards, Req, Get, Put } from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Role } from './roles.enum';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

class RegisterDto {
  @IsString()
  name!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(Role)
  role!: Role;
}

class LoginDto {
  @IsString()
  phone!: string;

  @IsString()
  password!: string;
}

class AdminSignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  name!: string;
}

class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  newPassword!: string;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

type AuthedRequest = { user: { userId: string; role: string } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  // ==================== MOBILE APP AUTH ====================
  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  // ==================== ADMIN WEB AUTH ====================
  @Post('admin/signup')
  adminSignup(@Body() body: AdminSignupDto) {
    return this.authService.adminSignup(body);
  }

  @Get('admin/check')
  async checkAdmin() {
    try {
      const result = await this.prisma.$queryRaw`SELECT * FROM admins WHERE email = 'shreysm8055@gmail.com' LIMIT 1`;
      const admin = Array.isArray(result) ? result[0] : null;
      if (admin) {
        return { exists: true, email: admin.email, hasPassword: !!admin.password, status: admin.status };
      }
      return { exists: false };
    } catch (error) {
      return { error: String(error) };
    }
  }

  @Post('admin/fix')
  async fixAdmin() {
    try {
      const password = await bcrypt.hash('outfytlogin@01', 12);
      
      // Check if exists using raw query
      const result = await this.prisma.$queryRaw`SELECT * FROM admins WHERE email = 'shreysm8055@gmail.com' LIMIT 1`;
      const existing = Array.isArray(result) ? result[0] : null;
      
      if (existing) {
        // Update using raw query
        await this.prisma.$executeRaw`UPDATE admins SET password = ${password}, status = 'active' WHERE email = 'shreysm8055@gmail.com'`;
        return { message: 'Admin password updated', email: 'shreysm8055@gmail.com' };
      }
      
      // Create using raw query
      await this.prisma.$executeRaw`INSERT INTO admins (id, email, name, password, role, status, created_at, updated_at) VALUES (gen_random_uuid(), 'shreysm8055@gmail.com', 'Super Admin', ${password}, 'admin', 'active', NOW(), NOW())`;
      return { message: 'Admin created', email: 'shreysm8055@gmail.com' };
    } catch (error) {
      return { message: 'Error', error: String(error) };
    }
  }

  @Post('admin/login')
  adminLogin(@Body() body: AdminLoginDto) {
    return this.authService.adminLogin(body);
  }

  @Post('admin/forgot-password')
  adminForgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.adminForgotPassword(body.email);
  }

  @Post('admin/reset-password')
  adminResetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.adminResetPassword(body);
  }

  @Get('admin/profile')
  @UseGuards(JwtAuthGuard)
  getAdminProfile(@Req() req: AuthedRequest) {
    return this.authService.getAdminProfile(req.user.userId);
  }

  @Put('admin/profile')
  @UseGuards(JwtAuthGuard)
  updateAdminProfile(@Req() req: AuthedRequest, @Body() body: UpdateProfileDto) {
    return this.authService.updateAdminProfile(req.user.userId, body);
  }

  @Post('admin/change-password')
  @UseGuards(JwtAuthGuard)
  changeAdminPassword(@Req() req: AuthedRequest, @Body() body: ChangePasswordDto) {
    return this.authService.changeAdminPassword(req.user.userId, body);
  }
}
