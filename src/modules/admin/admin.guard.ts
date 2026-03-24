import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'OPERATIONS', 'admin', 'super_admin', 'support', 'operations'] as const;

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId: string; role: string } | undefined;

    console.log('[AdminGuard] User:', user);

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const userRole = user.role?.toUpperCase() || '';
    console.log('[AdminGuard] User role:', userRole);
    
    // Check if role is in allowed list (case-insensitive)
    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'OPERATIONS'];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException('Admin access required');
    }

    // Check for specific role requirements
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('adminRoles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles && requiredRoles.length > 0) {
      const normalizedRequired = requiredRoles.map(r => r.toUpperCase());
      if (!normalizedRequired.includes(userRole)) {
        throw new ForbiddenException(`Required roles: ${requiredRoles.join(', ')}`);
      }
    }

    return true;
  }
}
