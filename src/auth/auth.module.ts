import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { SupabaseStrategy } from './supabase.strategy';
import { JwtStrategy } from './jwt.strategy';
import { MeController } from './me.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WebAuthController } from './web-auth.controller';
import { PrismaModule } from '../prisma/prisma.module';

// Hardcoded secret for consistency - in production this should be an env variable
const JWT_SECRET = 'outfyt-jwt-secret-key-change-in-production';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.register({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
    PrismaModule,
  ],
  controllers: [MeController, AuthController, WebAuthController],
  providers: [SupabaseStrategy, JwtStrategy, AuthService],
})
export class AuthModule {}
