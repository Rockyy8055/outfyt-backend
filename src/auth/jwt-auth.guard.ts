import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    
    this.logger.debug(`[JwtAuthGuard] Auth header: ${authHeader ? authHeader.substring(0, 30) + '...' : 'none'}`);
    
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      this.logger.error(`[JwtAuthGuard] Error: ${err?.message || 'No user'}`);
      this.logger.error(`[JwtAuthGuard] Info: ${info?.message || 'No info'}`);
      throw err || new UnauthorizedException('Invalid token');
    }
    return user;
  }
}
