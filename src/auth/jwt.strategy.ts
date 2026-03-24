import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from './roles.enum';

export type JwtPayload = {
  userId: string;
  role: Role;
};

// Same hardcoded secret as auth.module.ts
const JWT_SECRET = 'outfyt-jwt-secret-key-change-in-production';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    console.log('[JwtStrategy] Using hardcoded secret');
    
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload) {
    console.log('[JwtStrategy] Validating payload:', payload);
    return { userId: payload.userId, role: payload.role };
  }
}
