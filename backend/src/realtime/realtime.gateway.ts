import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Đẩy dữ liệu thời gian thực lên dashboard. Client gửi JWT trong handshake.auth.token.
 * Mỗi socket chỉ vào phòng của các thiết bị mà người dùng được xem (admin vào phòng chung).
 * Sự kiện: telemetry, device, alert, command.
 */
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('Realtime');

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth as { token?: string })?.token;
      if (!token) throw new Error('thiếu token');
      const payload = await this.jwt.verifyAsync<{ sub: number; jti?: string; tv?: number }>(token, { algorithms: ['HS256'] });
      if (!payload.jti) throw new Error('token không hợp lệ');
      if (await this.prisma.revokedToken.findUnique({ where: { jti: payload.jti } })) throw new Error('token đã bị thu hồi');
      const user = await this.prisma.user.findUnique({ where: { id: Number(payload.sub) } });
      if (!user || !user.active) throw new Error('tài khoản không hợp lệ');
      if (payload.tv !== user.tokenVersion) throw new Error('phiên đã hết hiệu lực');
      client.data.userId = user.id;
      client.data.jti = payload.jti;
      if (user.role === 'ADMIN') {
        client.join('role:admin');
      } else {
        const rows = await this.prisma.deviceAssignment.findMany({ where: { userId: user.id } });
        rows.forEach((r) => client.join(`device:${r.deviceId}`));
      }
    } catch (e) {
      this.logger.warn(`Từ chối kết nối websocket: ${(e as Error).message}`);
      client.emit('error', 'unauthorized');
      client.disconnect(true);
    }
  }

  /** Ngắt websocket của người dùng (một phiên theo jti, hoặc tất cả khi bị khóa/đổi mật khẩu). */
  async disconnectUser(userId: number, jti?: string) {
    const sockets = (await this.server?.fetchSockets()) ?? [];
    for (const s of sockets) {
      if (s.data.userId === userId && (!jti || s.data.jti === jti)) s.disconnect(true);
    }
  }

  emitDevice(deviceId: string, event: 'telemetry' | 'device' | 'alert' | 'command', payload: unknown) {
    this.server?.to([`device:${deviceId}`, 'role:admin']).emit(event, payload);
  }
}
