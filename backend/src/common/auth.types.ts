import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthService, TokenPayload } from '../auth/auth.service';

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const CurrentToken = createParamDecorator((_: unknown, ctx: ExecutionContext): TokenPayload => {
  return ctx.switchToHttp().getRequest().tokenPayload;
});

/** Xác thực JWT; kiểm tra token bị chặn và người dùng trong DB để khóa tài khoản có hiệu lực ngay. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) throw new UnauthorizedException('Thiếu token đăng nhập');
    const { user, payload } = await this.auth.authenticate(header.slice(7));
    req.user = { id: user.id, username: user.username, role: user.role } as AuthUser;
    req.tokenPayload = payload;
    return true;
  }
}

/** Kiểm tra vai trò theo @Roles(...). Không có @Roles thì chỉ cần đã đăng nhập. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (user && roles.includes(user.role)) return true;
    await this.audit.log({
      userId: user?.id,
      username: user?.username,
      action: 'ACCESS_DENIED',
      target: `${req.method} ${req.originalUrl}`,
      ip: req.ip,
    });
    throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
  }
}
