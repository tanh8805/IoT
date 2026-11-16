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
      const payload = await this.jwt.verifyAsync<{ sub: number }>(token, { algorithms: ['HS256'] });
      const user = await this.prisma.user.findUnique({ where: { id: Number(payload.sub) } });
      if (!user || !user.active) throw new Error('tài khoản không hợp lệ');
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

  emitDevice(deviceId: string, event: 'telemetry' | 'device' | 'alert' | 'command', payload: unknown) {
    this.server?.to([`device:${deviceId}`, 'role:admin']).emit(event, payload);
  }
}
