import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth.types';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export const ACTIONS = ['pump_on', 'pump_off', 'curtain_open', 'curtain_close'] as const;
export type Action = (typeof ACTIONS)[number];
export const COMMAND_TIMEOUT_MS = 10_000;

/** Trạng thái cho phép điều khiển/đổi cấu hình. */
export const CONTROLLABLE = ['ACTIVE', 'FAULT'];

@Injectable()
export class CommandsService {
  private readonly logger = new Logger('Commands');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
  ) {}

  assertControllable(state: string) {
    if (state === 'MAINTENANCE') throw new ConflictException('Thiết bị đang bảo trì, không nhận lệnh điều khiển');
    if (state === 'DECOMMISSIONED') throw new ConflictException('Thiết bị đã bị thu hồi');
    if (state === 'REGISTERED' || state === 'PROVISIONED') throw new ConflictException('Thiết bị chưa hoạt động (chưa gửi dữ liệu lần nào)');
    if (state === 'OFFLINE') throw new ConflictException('Thiết bị đang offline');
    if (!CONTROLLABLE.includes(state)) throw new ConflictException(`Không điều khiển được ở trạng thái ${state}`);
  }

  async send(user: AuthUser, deviceId: string, dto: { action: Action; duration_s?: number }, ip?: string) {
    const device = await this.access.assertAccess(user, deviceId);
    this.assertControllable(device.state);

    const payload: Record<string, unknown> = { cmd_id: randomUUID(), action: dto.action };
    let durationS: number | null = null;
    if (dto.action === 'pump_on') {
      durationS = dto.duration_s ?? 5;
      if (!Number.isInteger(durationS) || durationS < 1 || durationS > 15) throw new BadRequestException('duration_s phải là số nguyên từ 1 đến 15');
      payload.duration_s = durationS;
    } else if (dto.duration_s !== undefined) {
      throw new BadRequestException('duration_s chỉ dùng cho pump_on');
    }

    const cmd = await this.prisma.command.create({
      data: { id: payload.cmd_id as string, deviceId, action: dto.action, durationS, userId: user.id, username: user.username },
    });
    await this.audit.log({ userId: user.id, username: user.username, action: 'COMMAND_SEND', target: `device:${deviceId}`, detail: { cmd_id: cmd.id, action: dto.action, duration_s: durationS }, ip });
    try {
      await this.mqtt.publish(`devices/${deviceId}/cmd`, JSON.stringify(payload), 1, false);
    } catch (e) {
      const failed = await this.prisma.command.update({ where: { id: cmd.id }, data: { status: 'ERROR', msg: `Không gửi được lên broker: ${(e as Error).message}`, ackedAt: new Date() } });
      this.realtime.emitDevice(deviceId, 'command', failed);
      return failed;
    }
    this.realtime.emitDevice(deviceId, 'command', cmd);
    return cmd;
  }

  async list(user: AuthUser, deviceId: string, limit = 50) {
    await this.access.assertAccess(user, deviceId);
    return this.prisma.command.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 200) });
  }

  /** Xử lý ack từ devices/<id>/ack. */
  async handleAck(deviceId: string, body: { cmd_id?: unknown; result?: unknown; msg?: unknown }) {
    if (typeof body.cmd_id !== 'string' || (body.result !== 'ok' && body.result !== 'error')) {
      throw new Error('ack sai định dạng (cần cmd_id và result là "ok"/"error")');
    }
    const cmd = await this.prisma.command.findUnique({ where: { id: body.cmd_id } });
    if (!cmd || cmd.deviceId !== deviceId) {
      this.logger.warn(`Ack cho lệnh không biết: ${body.cmd_id} (thiết bị ${deviceId})`);
      return;
    }
    if (cmd.status !== 'PENDING') {
      this.logger.warn(`Ack muộn/trùng cho lệnh ${cmd.id} (đang ${cmd.status})`);
      return;
    }
    const updated = await this.prisma.command.update({
      where: { id: cmd.id },
      data: { status: body.result === 'ok' ? 'OK' : 'ERROR', msg: typeof body.msg === 'string' ? body.msg.slice(0, 200) : '', ackedAt: new Date() },
    });
    this.realtime.emitDevice(deviceId, 'command', updated);
  }

  /** Lệnh chưa có ack sau 10 giây → TIMEOUT. */
  async sweepTimeouts() {
    const stale = await this.prisma.command.findMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - COMMAND_TIMEOUT_MS) } },
    });
    for (const c of stale) {
      const updated = await this.prisma.command.update({ where: { id: c.id }, data: { status: 'TIMEOUT', msg: 'Không nhận được ack trong 10 giây' } });
      this.realtime.emitDevice(c.deviceId, 'command', updated);
    }
  }
}
