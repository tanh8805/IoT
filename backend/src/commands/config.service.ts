import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../common/access.service';
import { AuthUser } from '../common/auth.types';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CommandsService } from './commands.service';

export interface ConfigInput {
  soil_threshold?: number;
  lux_close?: number;
  lux_open?: number;
  low_soil_pct?: number;
}

@Injectable()
export class ConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    private readonly commands: CommandsService,
  ) {}

  /** Đổi ngưỡng: kiểm tra, publish devices/<id>/config (retain để thiết bị offline nhận khi nối lại), lưu lịch sử. */
  async change(user: AuthUser, deviceId: string, dto: ConfigInput, ip?: string) {
    const device = await this.access.assertAccess(user, deviceId);
    this.commands.assertControllable(device.state);
    if (dto.soil_threshold === undefined && dto.lux_close === undefined && dto.lux_open === undefined && dto.low_soil_pct === undefined) {
      throw new BadRequestException('Cần ít nhất một trong soil_threshold, lux_close, lux_open, low_soil_pct');
    }

    const oldValue = { soil_threshold: device.soilThreshold, lux_close: device.luxClose, lux_open: device.luxOpen, low_soil_pct: device.lowSoilPct };
    const newValue = {
      soil_threshold: dto.soil_threshold ?? device.soilThreshold,
      lux_close: dto.lux_close ?? device.luxClose,
      lux_open: dto.lux_open ?? device.luxOpen,
      low_soil_pct: dto.low_soil_pct ?? device.lowSoilPct,
    };
    if (newValue.lux_open >= newValue.lux_close) throw new BadRequestException('lux_open phải nhỏ hơn lux_close');

    // low_soil_pct chỉ backend dùng để sinh cảnh báo nên không gửi xuống thiết bị; chỉ publish khi đổi ngưỡng của thiết bị.
    const deviceSide = dto.soil_threshold !== undefined || dto.lux_close !== undefined || dto.lux_open !== undefined;
    if (deviceSide) {
      const { soil_threshold, lux_close, lux_open } = newValue;
      try {
        await this.mqtt.publish(`devices/${deviceId}/config`, JSON.stringify({ soil_threshold, lux_close, lux_open }), 1, true);
      } catch (e) {
        throw new BadRequestException(`Không gửi được cấu hình lên broker: ${(e as Error).message}`);
      }
    }
    const updated = await this.prisma.device.update({
      where: { id: deviceId },
      data: { soilThreshold: newValue.soil_threshold, luxClose: newValue.lux_close, luxOpen: newValue.lux_open, lowSoilPct: newValue.low_soil_pct },
    });
    await this.prisma.configChange.create({ data: { deviceId, userId: user.id, username: user.username, oldValue, newValue } });
    await this.audit.log({ userId: user.id, username: user.username, action: 'CONFIG_CHANGE', target: `device:${deviceId}`, detail: { from: oldValue, to: newValue }, ip });
    this.realtime.emitDevice(deviceId, 'device', updated);
    return updated;
  }

  async history(user: AuthUser, deviceId: string) {
    await this.access.assertAccess(user, deviceId);
    return this.prisma.configChange.findMany({ where: { deviceId }, orderBy: { id: 'desc' }, take: 100 });
  }
}
