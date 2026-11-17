import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface TokenPayload {
  sub: number;
  jti: string;
  tv: number;
  iat: number;
  exp: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
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
    const accessToken = await this.jwt.signAsync({ sub: user.id, username: user.username, role: user.role, tv: user.tokenVersion }, { jwtid: randomUUID() });
    return { accessToken, user: this.profile(user) };
  }

  /** Kiểm tra chữ ký/hạn của token, token có bị chặn không, người dùng còn hoạt động không. */
  async authenticate(token: string) {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
    if (!payload.jti) throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    if (await this.prisma.revokedToken.findUnique({ where: { jti: payload.jti } })) {
      throw new UnauthorizedException('Token đã bị thu hồi (đã đăng xuất)');
    }
    const user = await this.prisma.user.findUnique({ where: { id: Number(payload.sub) } });
    if (!user || !user.active) throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị khóa');
    if (payload.tv !== user.tokenVersion) {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hiệu lực, hãy đăng nhập lại');
    }
    return { user, payload };
  }

  /** Đăng xuất: đưa jti của token hiện tại vào danh sách chặn đến khi token hết hạn. */
  async logout(userId: number, username: string, payload: TokenPayload, ip?: string) {
    await this.prisma.revokedToken.upsert({
      where: { jti: payload.jti },
      create: { jti: payload.jti, userId, expiresAt: new Date(payload.exp * 1000) },
      update: {},
    });
    await this.prisma.revokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.audit.log({ userId, username, action: 'LOGOUT', ip });
    await this.realtime.disconnectUser(userId, payload.jti);
    return { ok: true };
  }

  async changePassword(userId: number, current: string, next: string, payload: TokenPayload, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!(await bcrypt.compare(current, user.passwordHash))) {
      await this.audit.log({ userId, username: user.username, action: 'PASSWORD_CHANGE_FAILED', detail: { reason: 'sai mật khẩu hiện tại' }, ip });
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    }
    if (current === next) throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(next, 10), tokenVersion: { increment: 1 } },
    });
    // Tăng tokenVersion làm mọi token cũ vô hiệu; vẫn ghi jti hiện tại vào danh sách chặn và ngắt websocket.
    await this.prisma.revokedToken.upsert({
      where: { jti: payload.jti },
      create: { jti: payload.jti, userId, expiresAt: new Date(payload.exp * 1000) },
      update: {},
    });
    await this.audit.log({ userId, username: user.username, action: 'PASSWORD_CHANGE', ip });
    await this.realtime.disconnectUser(userId);
    return { ok: true, message: 'Đã đổi mật khẩu, mọi phiên đăng nhập cũ đã hết hiệu lực. Hãy đăng nhập lại.' };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.profile(user);
  }

  async updateProfile(userId: number, dto: { fullName?: string; email?: string; phone?: string }, ip?: string) {
    const data = {
      fullName: dto.fullName,
      // Chuỗi rỗng = xóa thông tin.
      email: dto.email === undefined ? undefined : dto.email || null,
      phone: dto.phone === undefined ? undefined : dto.phone || null,
    };
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    await this.audit.log({ userId, username: user.username, action: 'PROFILE_UPDATE', detail: { fullName: dto.fullName, email: dto.email, phone: dto.phone }, ip });
    return this.profile(user);
  }

  private profile(u: { id: number; username: string; fullName: string; role: string; email: string | null; phone: string | null }) {
    return { id: u.id, username: u.username, fullName: u.fullName, role: u.role, email: u.email, phone: u.phone };
  }
}
