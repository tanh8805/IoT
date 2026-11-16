import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Device } from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import { CommandsService } from '../commands/commands.service';
import { DevicesService } from '../devices/devices.service';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { plausibilityProblem, validateTelemetry } from './telemetry.validator';

const LOW_SOIL_PCT = 20;
const TOPIC_RE = /^devices\/([^/]+)\/(telemetry|status|ack)$/;

/** Nhận bản tin MQTT của thiết bị: kiểm tra, lưu, cập nhật vòng đời, sinh cảnh báo, đẩy realtime. */
@Injectable()
export class IngestService implements OnModuleInit {
  private readonly logger = new Logger('Ingest');
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly mqtt: MqttService,
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly alerts: AlertsService,
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit() {
    this.mqtt.events.on('message', (topic: string, payload: Buffer) => {
      if (!TOPIC_RE.test(topic)) return;
      // Xử lý lần lượt để telemetry/status/ack không chạy chồng nhau.
      this.chain = this.chain
        .then(() => this.handle(topic, payload.toString()))
        .catch((e) => this.logger.error(`Lỗi xử lý ${topic}: ${(e as Error).message}`));
    });
  }

  async handle(topic: string, payload: string) {
    const m = TOPIC_RE.exec(topic);
    if (!m) return;
    const [, deviceId, kind] = m;
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      this.logger.warn(`Bỏ qua bản tin từ thiết bị không đăng ký: ${deviceId}`);
      return;
    }
    // Thu hồi (hoặc chưa cấp phát): bỏ qua mọi dữ liệu.
    if (device.state === 'DECOMMISSIONED' || device.state === 'REGISTERED') return;

    if (kind === 'telemetry') await this.onTelemetry(device, topic, payload);
    else if (kind === 'status') await this.onStatus(device, topic, payload);
    else await this.onAck(device, topic, payload);
  }

  private async reject(device: Device, topic: string, payload: string, reason: string) {
    this.logger.warn(`Từ chối bản tin ${topic}: ${reason}`);
    await this.prisma.ingestError.create({ data: { deviceId: device.id, topic, payload: payload.slice(0, 500), reason } });
    if (device.state !== 'MAINTENANCE') {
      await this.alerts.raise(device.id, 'ABNORMAL_DATA', 'WARNING', `Dữ liệu bất thường từ ${device.id}: ${reason}`);
    }
  }

  private async onTelemetry(device: Device, topic: string, payload: string) {
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      return this.reject(device, topic, payload, 'Payload không phải JSON hợp lệ');
    }
    const v = validateTelemetry(json);
    if (!v.ok) return this.reject(device, topic, payload, v.reason);
    const d = v.data;

    const row = await this.prisma.telemetry.create({ data: { deviceId: device.id, ...d } });
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(), lastTelemetry: { ...row, ts: row.ts.toISOString(), receivedAt: row.receivedAt.toISOString() } },
    });
    this.realtime.emitDevice(device.id, 'telemetry', row);

    // Đang bảo trì: vẫn lưu số đo nhưng không đổi trạng thái, không sinh cảnh báo.
    if (device.state === 'MAINTENANCE') return;

    const problem = plausibilityProblem(d);
    if (problem) {
      await this.devices.transition(device.id, 'FAULT', `Số đo vô lý: ${problem}`);
      await this.alerts.raise(device.id, 'ABNORMAL_DATA', 'CRITICAL', `Số đo vô lý từ ${device.id}: ${problem}`);
      return;
    }

    if (device.state === 'PROVISIONED' || device.state === 'OFFLINE' || device.state === 'FAULT') {
      await this.devices.transition(device.id, 'ACTIVE', 'Nhận telemetry hợp lệ');
    }
    await this.alerts.resolve(device.id, 'DEVICE_OFFLINE');
    await this.alerts.resolve(device.id, 'ABNORMAL_DATA');

    if (d.soilPct < LOW_SOIL_PCT) {
      await this.alerts.raise(device.id, 'LOW_SOIL', d.soilPct < 10 ? 'CRITICAL' : 'WARNING', `Đất khô: độ ẩm ${d.soilPct}% (dưới ${LOW_SOIL_PCT}%)`);
    } else {
      await this.alerts.resolve(device.id, 'LOW_SOIL');
    }
    if (d.autoBlocked) {
      await this.alerts.raise(device.id, 'AUTO_BLOCKED', 'WARNING', 'Thiết bị dừng tự tưới (auto_blocked): có thể bể cạn hoặc cảm biến tuột');
    } else {
      await this.alerts.resolve(device.id, 'AUTO_BLOCKED');
    }
  }

  private async onStatus(device: Device, topic: string, payload: string) {
    const s = payload.trim().toLowerCase();
    if (s !== 'online' && s !== 'offline') return this.reject(device, topic, payload, 'status phải là "online" hoặc "offline"');
    if (device.state === 'MAINTENANCE') return;

    if (s === 'online') {
      await this.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      if (device.state === 'PROVISIONED' || device.state === 'OFFLINE' || device.state === 'FAULT') {
        await this.devices.transition(device.id, 'ACTIVE', 'Thiết bị báo online');
      }
      await this.alerts.resolve(device.id, 'DEVICE_OFFLINE');
    } else if (device.state === 'ACTIVE' || device.state === 'FAULT') {
      await this.devices.transition(device.id, 'OFFLINE', 'Thiết bị báo offline (Last Will)');
      await this.alerts.raise(device.id, 'DEVICE_OFFLINE', 'CRITICAL', `Thiết bị ${device.id} đã offline`);
    }
  }

  private async onAck(device: Device, topic: string, payload: string) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(payload);
      if (typeof json !== 'object' || json === null) throw new Error();
    } catch {
      return this.reject(device, topic, payload, 'ack không phải JSON hợp lệ');
    }
    try {
      await this.commands.handleAck(device.id, json);
    } catch (e) {
      await this.reject(device, topic, payload, (e as Error).message);
    }
  }
}
