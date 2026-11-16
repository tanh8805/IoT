import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Device, DeviceState } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AlertsService } from '../alerts/alerts.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth.types';
import { BrokerAccountsService } from '../mqtt/broker-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export const DEVICE_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger('Devices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly broker: BrokerAccountsService,
    private readonly alerts: AlertsService,
  ) {}

  async list(user: AuthUser) {
    const ids = await this.access.accessibleDeviceIds(user);
    return this.prisma.device.findMany({
      where: ids ? { id: { in: ids } } : undefined,
      orderBy: { id: 'asc' },
    });
  }

  get(user: AuthUser, id: string) {
    return this.access.assertAccess(user, id);
  }

  /**
   * Chuyển trạng thái vòng đời, ghi lịch sử + audit + đẩy realtime.
   * DECOMMISSIONED là trạng thái cuối, không chuyển đi đâu nữa.
   */
  async transition(deviceId: string, to: DeviceState, reason: string, actor?: AuthUser, extra: { lastSeenAt?: Date } = {}) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Không tìm thấy thiết bị');
    if (device.state === 'DECOMMISSIONED') return device;
    if (device.state === to) {
      return Object.keys(extra).length ? this.prisma.device.update({ where: { id: deviceId }, data: extra }) : device;
    }
    const updated = await this.prisma.device.update({ where: { id: deviceId }, data: { state: to, ...extra } });
    await this.prisma.deviceStateHistory.create({
      data: { deviceId, from: device.state, to, reason, actor: actor?.username || 'system' },
    });
    await this.audit.log({
      userId: actor?.id,
      username: actor?.username,
      action: 'DEVICE_STATE',
      target: `device:${deviceId}`,
      detail: { from: device.state, to, reason },
    });
    this.realtime.emitDevice(deviceId, 'device', updated);
    this.logger.log(`${deviceId}: ${device.state} → ${to} (${reason})`);
    return updated;
  }

  async create(actor: AuthUser, dto: { id: string; name: string; location?: string }, ip?: string) {
    if (!DEVICE_ID_RE.test(dto.id)) {
      throw new BadRequestException('Mã thiết bị chỉ gồm chữ thường, số, dấu gạch ngang (2–32 ký tự)');
    }
    if (await this.prisma.device.findUnique({ where: { id: dto.id } })) throw new ConflictException('Mã thiết bị đã tồn tại');
    const device = await this.prisma.device.create({
      data: {
        id: dto.id,
        name: dto.name,
        location: dto.location || '',
        stateHistory: { create: { to: 'REGISTERED', reason: 'Admin đăng ký thiết bị', actor: actor.username } },
      },
    });
    await this.audit.log({ userId: actor.id, username: actor.username, action: 'DEVICE_CREATE', target: `device:${dto.id}`, detail: { name: dto.name }, ip });
    return device;
  }

  async update(actor: AuthUser, id: string, dto: { name?: string; location?: string }, ip?: string) {
    await this.mustGet(id);
    const device = await this.prisma.device.update({ where: { id }, data: { name: dto.name, location: dto.location } });
    await this.audit.log({ userId: actor.id, username: actor.username, action: 'DEVICE_UPDATE', target: `device:${id}`, detail: dto as object, ip });
    return device;
  }

  /** Registered → Provisioned. Mật khẩu MQTT chỉ trả về đúng một lần này. */
  async provision(actor: AuthUser, id: string, ip?: string) {
    const device = await this.mustGet(id);
    if (device.state !== 'REGISTERED') throw new ConflictException(`Thiết bị đang ở trạng thái ${device.state}, chỉ cấp phát được khi REGISTERED`);
    const password = randomBytes(18).toString('base64url');
    try {
      await this.broker.createAccount(id, password);
    } catch (e) {
      throw new ConflictException(`Không tạo được tài khoản MQTT trên broker: ${(e as Error).message}`);
    }
    await this.transition(id, 'PROVISIONED', 'Đã tạo tài khoản MQTT', actor);
    await this.audit.log({ userId: actor.id, username: actor.username, action: 'DEVICE_PROVISION', target: `device:${id}`, ip });
    return { deviceId: id, mqttUsername: id, mqttPassword: password, note: 'Mật khẩu chỉ hiển thị một lần, hãy lưu lại ngay.' };
  }

  async setMaintenance(actor: AuthUser, id: string, enabled: boolean, ip?: string) {
    const device = await this.mustGet(id);
    if (device.state === 'DECOMMISSIONED' || device.state === 'REGISTERED') {
      throw new ConflictException(`Không thể đổi bảo trì khi thiết bị ở trạng thái ${device.state}`);
    }
    let updated: Device;
    if (enabled) {
      updated = await this.transition(id, 'MAINTENANCE', 'Admin bật bảo trì', actor);
      await this.alerts.resolveAll(id);
    } else {
      if (device.state !== 'MAINTENANCE') throw new ConflictException('Thiết bị không ở chế độ bảo trì');
      // Quay về PROVISIONED; có telemetry/status online hợp lệ tiếp theo sẽ thành ACTIVE.
      updated = await this.transition(id, 'PROVISIONED', 'Admin tắt bảo trì', actor);
    }
    await this.audit.log({ userId: actor.id, username: actor.username, action: 'DEVICE_MAINTENANCE', target: `device:${id}`, detail: { enabled }, ip });
    return updated;
  }

  /** Thu hồi: vô hiệu tài khoản MQTT (broker ngắt và từ chối kết nối), backend bỏ qua dữ liệu từ thiết bị. */
  async decommission(actor: AuthUser, id: string, ip?: string) {
    const device = await this.mustGet(id);
    if (device.state === 'DECOMMISSIONED') throw new ConflictException('Thiết bị đã được thu hồi');
    if (device.state !== 'REGISTERED') {
      try {
        await this.broker.disableAccount(id);
      } catch (e) {
        throw new ConflictException(`Không vô hiệu hóa được tài khoản MQTT: ${(e as Error).message}`);
      }
    }
    await this.alerts.resolveAll(id);
    const updated = await this.transition(id, 'DECOMMISSIONED', 'Admin thu hồi thiết bị', actor);
    await this.audit.log({ userId: actor.id, username: actor.username, action: 'DEVICE_DECOMMISSION', target: `device:${id}`, ip });
    return updated;
  }

  async telemetry(user: AuthUser, id: string, q: { from?: string; to?: string; limit?: number }) {
    await this.access.assertAccess(user, id);
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 60 * 60 * 1000);
    const to = q.to ? new Date(q.to) : undefined;
    if (isNaN(from.getTime()) || (to && isNaN(to.getTime()))) throw new BadRequestException('from/to phải là thời gian ISO 8601');
    const rows = await this.prisma.telemetry.findMany({
      where: { deviceId: id, ts: { gte: from, ...(to ? { lte: to } : {}) } },
      orderBy: { ts: 'desc' },
      take: Math.min(Math.max(q.limit || 1000, 1), 5000),
    });
    return rows.reverse();
  }

  async stateHistory(user: AuthUser, id: string) {
    await this.access.assertAccess(user, id);
    return this.prisma.deviceStateHistory.findMany({ where: { deviceId: id }, orderBy: { id: 'desc' }, take: 100 });
  }

  private async mustGet(id: string) {
    const d = await this.prisma.device.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Không tìm thấy thiết bị');
    return d;
  }
}
