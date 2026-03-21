import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from './roles.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

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

  private async signToken(payload: { userId: string; role: Role }) {
    return this.jwtService.signAsync(payload);
  }
}
