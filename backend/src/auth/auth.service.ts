import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(username: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    // So sánh hash cả khi không có user để thời gian phản hồi không lộ tên tài khoản.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok || !user.active) {
      await this.audit.log({ userId: user?.id, username, action: 'LOGIN_FAILED', detail: { reason: !user || !ok ? 'sai thông tin' : 'tài khoản bị khóa' }, ip });
      throw new UnauthorizedException('Sai tên đăng nhập hoặc mật khẩu');
    }
    await this.audit.log({ userId: user.id, username, action: 'LOGIN', ip });
    const accessToken = await this.jwt.signAsync({ sub: user.id, username: user.username, role: user.role });
    return { accessToken, user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role } };
  }
}
