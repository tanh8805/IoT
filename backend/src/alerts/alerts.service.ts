import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertSeverity, AlertStatus, AlertType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const UNRESOLVED: AlertStatus[] = ['NEW', 'ACKNOWLEDGED'];

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /** Tạo cảnh báo; bỏ qua nếu đã có cảnh báo chưa giải quyết cùng loại cho thiết bị. */
  async raise(deviceId: string, type: AlertType, severity: AlertSeverity, message: string) {
    const open = await this.prisma.alert.findFirst({ where: { deviceId, type, status: { in: UNRESOLVED } } });
    if (open) return null;
    const alert = await this.prisma.alert.create({ data: { deviceId, type, severity, message } });
    this.realtime.emitDevice(deviceId, 'alert', alert);
    return alert;
  }

  /** Đóng các cảnh báo cùng loại khi điều kiện đã hết. */
  async resolve(deviceId: string, type: AlertType) {
    const open = await this.prisma.alert.findMany({ where: { deviceId, type, status: { in: UNRESOLVED } } });
    for (const a of open) {
      const updated = await this.prisma.alert.update({ where: { id: a.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
      this.realtime.emitDevice(deviceId, 'alert', updated);
    }
  }

  async resolveAll(deviceId: string) {
    for (const type of ['LOW_SOIL', 'AUTO_BLOCKED', 'DEVICE_OFFLINE', 'ABNORMAL_DATA'] as AlertType[]) {
      await this.resolve(deviceId, type);
    }
  }

  async list(user: AuthUser, q: { status?: AlertStatus; deviceId?: string; limit?: number }) {
    const ids = await this.access.accessibleDeviceIds(user);
    if (q.deviceId && ids && !ids.includes(q.deviceId)) throw new ForbiddenException('Thiết bị này chưa được gán cho bạn');
    return this.prisma.alert.findMany({
      where: {
        status: q.status,
        deviceId: q.deviceId ? q.deviceId : ids ? { in: ids } : undefined,
      },
      orderBy: { id: 'desc' },
      take: Math.min(q.limit || 200, 500),
    });
  }

  async acknowledge(user: AuthUser, id: number, ip?: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Không tìm thấy cảnh báo');
    await this.access.assertAccess(user, alert.deviceId);
    if (alert.status !== 'NEW') return alert;
    const updated = await this.prisma.alert.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', ackedById: user.id, ackedByName: user.username, ackedAt: new Date() },
    });
    this.realtime.emitDevice(alert.deviceId, 'alert', updated);
    await this.audit.log({ userId: user.id, username: user.username, action: 'ALERT_ACK', target: `alert:${id}`, detail: { deviceId: alert.deviceId, type: alert.type }, ip });
    return updated;
  }
}
