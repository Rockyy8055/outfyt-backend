import { Body, Controller, Post, UseGuards, Req, Get, Put, UnauthorizedException } from '@nestjs/common';
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
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    });
    
    const result = await pool.query('SELECT * FROM admins WHERE email = $1 LIMIT 1', ['shreyasm8055@gmail.com']);
    const admin = result.rows[0];
    
    if (admin) {
      return { exists: true, email: admin.email, hasPassword: !!admin.password, status: admin.status };
    }
    return { exists: false };
  }

  @Get('admin/debug')
  async debugAdmin() {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    });
    
    const result = await pool.query('SELECT * FROM admins WHERE email = $1 LIMIT 1', ['shreyasm8055@gmail.com']);
    const row = result.rows[0];
    
    if (!row) {
      return { exists: false };
    }
    
    // Test password comparison
    const testResult = await bcrypt.compare('Outfytlogin@01', row.password);
    
    return {
      exists: true,
      email: row.email,
      passwordLength: row.password?.length,
      passwordStart: row.password?.substring(0, 10),
      testPasswordMatch: testResult,
      status: row.status,
    };
  }

  @Post('admin/fix')
  async fixAdmin() {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    });
    
    const password = await bcrypt.hash('Outfytlogin@01', 12);
    
    // Check if exists
    const result = await pool.query('SELECT * FROM admins WHERE email = $1 LIMIT 1', ['shreyasm8055@gmail.com']);
    const existing = result.rows[0];
    
    if (existing) {
      // Update password
      await pool.query('UPDATE admins SET password = $1, status = $2 WHERE email = $3', [password, 'active', 'shreyasm8055@gmail.com']);
      return { message: 'Admin password updated', email: 'shreyasm8055@gmail.com' };
    }
    
    // Create new admin
    await pool.query(
      'INSERT INTO admins (id, email, name, password, role, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())',
      ['shreyasm8055@gmail.com', 'Super Admin', password, 'admin', 'active']
    );
    return { message: 'Admin created', email: 'shreyasm8055@gmail.com' };
  }

  @Post('admin/login')
  async adminLoginDirect(@Body() body: AdminLoginDto) {
    console.log('[LOGIN] Attempt for:', body.email);
    
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    });
    
    const result = await pool.query('SELECT * FROM admins WHERE email = $1 LIMIT 1', [body.email]);
    const row = result.rows[0];
    console.log('[LOGIN] Found user:', row ? row.email : 'not found');
    
    if (!row || !row.password) {
      console.log('[LOGIN] No user or password');
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(body.password, row.password);
    console.log('[LOGIN] Password valid:', isValid);
    
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Map snake_case to camelCase (id is mapped to user_id in schema)
    const admin = {
      id: row.user_id || row.id,
      email: row.email,
      name: row.name || 'Admin',
      role: row.role || 'admin',
      avatar: row.avatar,
    };
    
    console.log('[LOGIN] Admin object:', admin);

    // Generate JWT token
    const token = await this.jwtService.signAsync({ 
      userId: admin.id, 
      role: admin.role 
    });
    console.log('[LOGIN] Token generated');

    return {
      admin,
      accessToken: token,
    };
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
