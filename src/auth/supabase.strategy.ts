import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type SupabaseJwtPayload = {
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  user_metadata?: { role?: string };
  [key: string]: unknown;
};

@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('SUPABASE_JWT_SECRET'),
    });
  }

  async validate(payload: SupabaseJwtPayload) {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid Supabase token');
    }

    console.log('[AUTH] Supabase token verified, sub:', payload.sub);

    const extractedRoleRaw =
      (typeof payload.role === 'string' ? payload.role : undefined) ??
      (typeof payload.user_metadata?.role === 'string'
        ? payload.user_metadata.role
        : undefined) ??
      'CUSTOMER';

    const roleUpper = extractedRoleRaw.toUpperCase();
    const normalizedRole = (Object.values(Role) as string[]).includes(roleUpper)
      ? (roleUpper as Role)
      : Role.CUSTOMER;

    const supabaseUserId = payload.sub;
    const phone = payload.phone;

    type UserInfo = { id: string; role: Role; phone: string | null };
    let existingUser: UserInfo | null = null;
    
    // CRITICAL FIX: Find user by phone first (same user for web and mobile)
    if (phone) {
      existingUser = await this.prisma.user.findUnique({
        where: { phone },
        select: { id: true, role: true, phone: true },
      });
      
      if (existingUser) {
        console.log(`[AUTH] Found existing user by phone: ${phone}, userId: ${existingUser.id}`);
      }
    }

    // If not found by phone, try by ID (for backward compatibility)
    if (!existingUser) {
      existingUser = await this.prisma.user.findUnique({
        where: { id: supabaseUserId },
        select: { id: true, role: true, phone: true },
      });
      
      if (existingUser) {
        console.log(`[AUTH] Found existing user by ID: ${supabaseUserId}`);
      }
    }

    // If user still not found, create new user with Supabase ID
    if (!existingUser) {
      existingUser = await this.prisma.user.create({
        data: {
          id: supabaseUserId,
          name: null,
          phone: phone ?? null,
          email: payload.email,
          password: null,
          role: normalizedRole,
        },
        select: { id: true, role: true, phone: true },
      });
      console.log(`[AUTH] Created new user: ${existingUser.id}, phone: ${existingUser.phone}, role: ${existingUser.role}`);
    }

    console.log(`[AUTH] Final userId: ${existingUser.id}, role: ${existingUser.role}`);

    return {
      userId: existingUser.id,
      role: existingUser.role,
    };
  }
}
