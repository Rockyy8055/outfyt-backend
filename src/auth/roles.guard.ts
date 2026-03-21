import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId: string; role: string } | undefined;

    if (!user) {
      throw new ForbiddenException('Missing authenticated user');
    }

    const userRole = String(user.role).toUpperCase();
    const normalizedRequired = requiredRoles.map((r) => String(r).toUpperCase());

    if (!normalizedRequired.includes(userRole)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
