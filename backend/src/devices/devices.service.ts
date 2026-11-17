import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Device, DeviceState, Prisma } from '@prisma/client';
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

  async create(actor: AuthUser, dto: { id: string; name: string; location?: string; hwVersion?: string }, ip?: string) {
    if (!DEVICE_ID_RE.test(dto.id)) {
      throw new BadRequestException('Mã thiết bị chỉ gồm chữ thường, số, dấu gạch ngang (2–32 ký tự)');
    }
    if (await this.prisma.device.findUnique({ where: { id: dto.id } })) throw new ConflictException('Mã thiết bị đã tồn tại');
    const device = await this.prisma.device.create({
      data: {
        id: dto.id,
        name: dto.name,
        location: dto.location || '',
        hwVersion: dto.hwVersion || null,
        stateHistory: { create: { to: 'REGISTERED', reason: 'Admin đăng ký thiết bị', actor: actor.username } },
      },
    });
    await this.audit.log({ userId: actor.id, username: actor.username, action: 'DEVICE_CREATE', target: `device:${dto.id}`, detail: { name: dto.name }, ip });
    return device;
  }

  async update(actor: AuthUser, id: string, dto: { name?: string; location?: string; hwVersion?: string }, ip?: string) {
    await this.mustGet(id);
    const device = await this.prisma.device.update({
      where: { id },
      data: { name: dto.name, location: dto.location, hwVersion: dto.hwVersion === undefined ? undefined : dto.hwVersion || null },
    });
    this.realtime.emitDevice(id, 'device', device);
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

  /** Xuất CSV số đo trong khoảng thời gian (tối đa 100000 dòng, mặc định 7 ngày gần nhất). */
  async exportCsv(user: AuthUser, id: string, q: { from?: string; to?: string }, ip?: string) {
    await this.access.assertAccess(user, id);
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 7 * 86400_000);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new BadRequestException('from/to phải là thời gian ISO 8601');
    const rows = await this.prisma.telemetry.findMany({
      where: { deviceId: id, ts: { gte: from, lte: to } },
      orderBy: { ts: 'asc' },
      take: 100_000,
    });
    const esc = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = ['ts_utc,received_at_utc,soil_raw,soil_pct,lux,pump,curtain,auto_blocked,fw'];
    for (const r of rows) {
      lines.push([r.ts.toISOString(), r.receivedAt.toISOString(), r.soilRaw, r.soilPct, r.lux, r.pump, r.curtain, r.autoBlocked, r.fw].map(esc).join(','));
    }
    await this.audit.log({ userId: user.id, username: user.username, action: 'DATA_EXPORT', target: `device:${id}`, detail: { from, to, rows: rows.length }, ip });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /**
   * Thống kê min/max/trung bình độ ẩm đất (soil_pct, %) và ánh sáng (lux, lx) theo giờ hoặc ngày.
   * Ranh giới giờ/ngày tính theo múi giờ `tz` (mặc định UTC); mỗi dòng trả thời điểm bắt đầu khoảng (ISO, UTC).
   */
  async stats(user: AuthUser, id: string, q: { granularity?: string; from?: string; to?: string; tz?: string }) {
    await this.access.assertAccess(user, id);
    const unit = q.granularity === 'day' ? 'day' : q.granularity === 'hour' || !q.granularity ? 'hour' : null;
    if (!unit) throw new BadRequestException('granularity phải là "hour" hoặc "day"');
    const tz = q.tz || 'UTC';
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      throw new BadRequestException('tz phải là tên múi giờ IANA, ví dụ Asia/Ho_Chi_Minh');
    }
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - (unit === 'hour' ? 24 : 30 * 24) * 3600_000);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new BadRequestException('from/to phải là thời gian ISO 8601');
    if (from >= to) throw new BadRequestException('from phải nhỏ hơn to');
    if (to.getTime() - from.getTime() > 400 * 86400_000) throw new BadRequestException('Khoảng thời gian tối đa 400 ngày');
    const rows = await this.prisma.$queryRaw<
      { bucket: Date; samples: number; soil_min: number; soil_max: number; soil_avg: number; lux_min: number | null; lux_max: number | null; lux_avg: number | null; lux_samples: number }[]
    >(Prisma.sql`
      SELECT (date_trunc(${unit}::text, ("ts" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text) AT TIME ZONE ${tz}::text) AS bucket,
             COUNT(*)::int AS samples,
             MIN("soilPct")::float8 AS soil_min, MAX("soilPct")::float8 AS soil_max, AVG("soilPct")::float8 AS soil_avg,
             MIN("lux")::float8 AS lux_min, MAX("lux")::float8 AS lux_max, AVG("lux")::float8 AS lux_avg,
             COUNT("lux")::int AS lux_samples
      FROM "Telemetry"
      WHERE "deviceId" = ${id} AND "ts" >= ${from} AND "ts" <= ${to}
      GROUP BY 1 ORDER BY 1`);
    const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    return {
      deviceId: id,
      granularity: unit,
      tz,
      from,
      to,
      units: { soil: '%', lux: 'lx' },
      buckets: rows.map((r) => ({
        start: r.bucket,
        samples: r.samples,
        soil: { min: r.soil_min, max: r.soil_max, avg: r1(r.soil_avg) },
        // lux có thể null (cảm biến lỗi): null khi cả khoảng không có số đo lux.
        lux: { min: r.lux_min, max: r.lux_max, avg: r1(r.lux_avg), samples: r.lux_samples },
      })),
    };
  }

  async firmwareHistory(user: AuthUser, id: string) {
    await this.access.assertAccess(user, id);
    return this.prisma.deviceFirmwareHistory.findMany({ where: { deviceId: id }, orderBy: { id: 'desc' }, take: 100 });
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
