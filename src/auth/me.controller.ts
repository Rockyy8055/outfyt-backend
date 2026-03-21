import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

type AuthedRequest = {
  user: { userId: string; role: string };
};

@Controller()
export class MeController {
  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  me(@Req() req: AuthedRequest) {
    return {
      userId: req.user.userId,
      role: req.user.role,
    };
  }

  @Get('store-only')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('STORE')
  storeOnly(@Req() req: AuthedRequest) {
    return {
      ok: true,
      userId: req.user.userId,
      role: req.user.role,
    };
  }

  @Get('rider-only')
  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles('RIDER')
  riderOnly(@Req() req: AuthedRequest) {
    return {
      ok: true,
      userId: req.user.userId,
      role: req.user.role,
    };
  }
}
