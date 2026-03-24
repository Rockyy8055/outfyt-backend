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

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('SUPABASE_JWT_SECRET') || 
                configService.get<string>('JWT_SECRET') || 
                'outfyt-jwt-secret-key-change-in-production',
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
  ],
  controllers: [MeController, AuthController, WebAuthController],
  providers: [SupabaseStrategy, JwtStrategy, AuthService],
})
export class AuthModule {}
