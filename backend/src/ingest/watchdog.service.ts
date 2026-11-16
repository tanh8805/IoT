import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service';
import { CommandsService } from '../commands/commands.service';
import { DevicesService } from '../devices/devices.service';
import { PrismaService } from '../prisma/prisma.service';

export const OFFLINE_AFTER_MS = 35_000;

/** Mỗi 5 giây: thiết bị quá 35 giây không có dữ liệu → OFFLINE; lệnh quá 10 giây không ack → TIMEOUT. */
@Injectable()
export class WatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Watchdog');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly alerts: AlertsService,
    private readonly commands: CommandsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 5000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const stale = await this.prisma.device.findMany({
        where: { state: { in: ['ACTIVE', 'FAULT'] }, lastSeenAt: { lt: new Date(Date.now() - OFFLINE_AFTER_MS) } },
      });
      for (const d of stale) {
        await this.devices.transition(d.id, 'OFFLINE', 'Quá 35 giây không có dữ liệu');
        await this.alerts.raise(d.id, 'DEVICE_OFFLINE', 'CRITICAL', `Thiết bị ${d.id} mất kết nối (quá 35 giây không có telemetry)`);
      }
      await this.commands.sweepTimeouts();
    } catch (e) {
      this.logger.error(`Lỗi watchdog: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
