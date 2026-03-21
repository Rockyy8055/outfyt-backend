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

    console.log('[auth] token verified');

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

    const userId = payload.sub;
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!existing) {
      await this.prisma.user.create({
        data: {
          id: userId,
          name: null,
          phone: payload.phone ?? null,
          email: payload.email,
          password: null,
          role: normalizedRole,
        },
        select: { id: true },
      });
      console.log('[auth] user synced');
    }

    if (existing) {
      console.log('[auth] user exists');
    }

    const finalRole = existing?.role ?? normalizedRole;

    return {
      userId,
      role: finalRole,
    };
  }
}
