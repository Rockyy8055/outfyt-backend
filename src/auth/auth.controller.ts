import { Body, Controller, Post, UseGuards, Req, Get, Put } from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Role } from './roles.enum';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
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
    private readonly jwtService: JwtService,
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
      const admin = await this.prisma.admin.findUnique({
        where: { email: 'shreysm8055@gmail.com' },
      });
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
      
      const existing = await this.prisma.admin.findUnique({
        where: { email: 'shreysm8055@gmail.com' },
      });
      
      if (existing) {
        await this.prisma.admin.update({
          where: { id: existing.id },
          data: { password, status: 'active' },
        });
        return { message: 'Admin password updated', email: 'shreysm8055@gmail.com' };
      }
      
      const admin = await this.prisma.admin.create({
        data: {
          email: 'shreysm8055@gmail.com',
          name: 'Super Admin',
          password: password,
          role: 'admin',
          status: 'active',
        },
      });
      return { message: 'Admin created', email: admin.email };
    } catch (error) {
      return { message: 'Error', error: String(error) };
    }
  }

  @Post('admin/login')
  async adminLoginDirect(@Body() body: AdminLoginDto) {
    try {
      // Direct SQL query to bypass Prisma prepared statement issues
      const result = await this.prisma.$queryRaw`
        SELECT * FROM admins WHERE email = ${body.email} LIMIT 1
      `;
      const admin = Array.isArray(result) ? result[0] : null;
      
      if (!admin || !admin.password) {
        return { error: 'Invalid credentials' };
      }

      const isValid = await bcrypt.compare(body.password, admin.password);
      if (!isValid) {
        return { error: 'Invalid credentials' };
      }

      // Generate JWT token
      const token = await this.jwtService.signAsync({ 
        userId: admin.id, 
        role: admin.role || 'admin' 
      });

      return {
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name || 'Admin',
          role: admin.role || 'admin',
        },
        accessToken: token,
      };
    } catch (error) {
      return { error: 'Login failed', details: String(error) };
    }
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
