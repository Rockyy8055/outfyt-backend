import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from './roles.enum';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ==================== MOBILE APP AUTH ====================
  async register(input: {
    name: string;
    phone: string;
    email?: string;
    password: string;
    role: Role;
  }) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: input.phone },
          ...(input.email ? [{ email: input.email }] : []),
        ],
      },
      select: { id: true },
    });

    if (existing) throw new ConflictException('User already exists');

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email,
        password: passwordHash,
        role: input.role,
      },
      select: { id: true, name: true, phone: true, email: true, role: true },
    });

    return {
      user,
      accessToken: await this.signToken({ userId: user.id, role: user.role }),
    };
  }

  async login(input: { phone: string; password: string }) {
    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });

    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(input.password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return {
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
      accessToken: await this.signToken({ userId: user.id, role: user.role }),
    };
  }

  // ==================== ADMIN WEB AUTH ====================
  async adminSignup(input: { email: string; password: string; name: string }) {
    const existingAdmin = await this.prisma.admin.findUnique({
      where: { email: input.email },
    });

    if (existingAdmin) {
      throw new ConflictException('Admin with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const admin = await this.prisma.admin.create({
      data: {
        email: input.email,
        name: input.name,
        password: passwordHash,
        role: 'admin',
      },
      select: { id: true, email: true, name: true, role: true },
    });

    this.logger.log(`Admin created: ${admin.email}`);

    return {
      admin,
      message: 'Admin account created. Please verify your email.',
    };
  }

  async adminLogin(input: { email: string; password: string }) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: input.email },
    });

    if (!admin || !admin.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (admin.status !== 'active') {
      throw new UnauthorizedException('Account is deactivated');
    }

    const isValid = await bcrypt.compare(input.password, admin.password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { lastLogin: new Date() },
    });

    this.logger.log(`Admin logged in: ${admin.email}`);

    return {
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        avatar: admin.avatar,
      },
      accessToken: await this.signToken({ userId: admin.id, role: admin.role as Role }),
    };
  }

  async adminForgotPassword(email: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      return { message: 'If the email exists, a reset link will be sent.' };
    }

    const resetToken = this.jwtService.sign(
      { email: admin.email, type: 'reset' },
      { expiresIn: '1h' },
    );

    const tokenHash = await bcrypt.hash(resetToken, 10);
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { resetToken: tokenHash, resetTokenExpiry: new Date(Date.now() + 3600000) },
    });

    this.logger.log(`Password reset requested for: ${email}`);

    return {
      message: 'If the email exists, a reset link will be sent.',
      debugToken: process.env.NODE_ENV === 'development' ? resetToken : undefined,
    };
  }

  async adminResetPassword(input: { token: string; password: string }) {
    let payload: { email: string; type: string };
    try {
      payload = this.jwtService.verify(input.token);
      if (payload.type !== 'reset') {
        throw new BadRequestException('Invalid token type');
      }
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const admin = await this.prisma.admin.findUnique({
      where: { email: payload.email },
    });

    if (!admin || !admin.resetToken) {
      throw new BadRequestException('Invalid reset request');
    }

    const isValid = await bcrypt.compare(input.token, admin.resetToken);
    if (!isValid || !admin.resetTokenExpiry || admin.resetTokenExpiry < new Date()) {
      throw new BadRequestException('Reset token expired');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: {
        password: passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Password reset for: ${admin.email}`);

    return { message: 'Password updated successfully' };
  }

  async getAdminProfile(adminId: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        status: true,
        lastLogin: true,
        createdAt: true,
      },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    return admin;
  }

  async updateAdminProfile(adminId: string, data: { name?: string; avatar?: string }) {
    const admin = await this.prisma.admin.update({
      where: { id: adminId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
      },
    });

    return admin;
  }

  async changeAdminPassword(
    adminId: string,
    data: { currentPassword: string; newPassword: string },
  ) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin || !admin.password) {
      throw new UnauthorizedException('Admin not found');
    }

    const isValid = await bcrypt.compare(data.currentPassword, admin.password);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 12);
    await this.prisma.admin.update({
      where: { id: adminId },
      data: {
        password: passwordHash,
        updatedAt: new Date(),
      },
    });

    return { message: 'Password changed successfully' };
  }

  private async signToken(payload: { userId: string; role: Role | string }) {
    return this.jwtService.signAsync(payload);
  }
}
