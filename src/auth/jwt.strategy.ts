import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from './roles.enum';

export type JwtPayload = {
  userId: string;
  role: Role;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('SUPABASE_JWT_SECRET') || 
                   configService.get<string>('JWT_SECRET') || 
                   'outfyt-jwt-secret-key-change-in-production';
    console.log('[JwtStrategy] Using secret:', secret ? secret.substring(0, 10) + '...' : 'none');
    
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    console.log('[JwtStrategy] Validating payload:', payload);
    return { userId: payload.userId, role: payload.role };
  }
}
