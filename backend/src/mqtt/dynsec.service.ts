import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DYNSEC_RESPONSE, DYNSEC_TOPIC, MqttService } from './mqtt.service';

type Pending = { resolve: (r: DynsecResponse) => void; timer: NodeJS.Timeout };
export interface DynsecResponse {
  command: string;
  error?: string;
  data?: unknown;
  correlationData?: string;
}

/**
 * Gọi plugin Dynamic Security của Mosquitto qua $CONTROL/dynamic-security/v1.
 * Backend đăng nhập bằng user quản trị (role admin của dynsec) nên được phép gọi.
 */
@Injectable()
export class DynsecService {
  private readonly logger = new Logger('Dynsec');
  private readonly pending = new Map<string, Pending>();
  private listening = false;

  constructor(private readonly mqtt: MqttService) {
    this.mqtt.events.on('message', (topic: string, payload: Buffer) => {
      if (topic !== DYNSEC_RESPONSE) return;
      try {
        const body = JSON.parse(payload.toString());
        for (const r of (body.responses || []) as DynsecResponse[]) {
          const p = r.correlationData ? this.pending.get(r.correlationData) : undefined;
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(r.correlationData!);
            p.resolve(r);
          }
        }
      } catch (e) {
        this.logger.warn(`Phản hồi dynsec không đọc được: ${e}`);
      }
    });
  }

  /** Đăng ký nhận phản hồi; gọi mỗi lần (nối lại) broker. */
  async listen() {
    await this.mqtt.subscribe([DYNSEC_RESPONSE]);
    this.listening = true;
  }

  /** Gửi một lệnh, trả về phản hồi. Lỗi nghiệp vụ nằm ở `error` của phản hồi. */
  async command(command: string, args: Record<string, unknown> = {}, timeoutMs = 5000): Promise<DynsecResponse> {
    if (!this.listening) await this.listen();
    const correlationData = randomUUID();
    const result = new Promise<DynsecResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationData);
        reject(new Error(`Dynsec không phản hồi lệnh ${command}`));
      }, timeoutMs);
      this.pending.set(correlationData, { resolve, timer });
    });
    await this.mqtt.publish(DYNSEC_TOPIC, JSON.stringify({ commands: [{ command, ...args, correlationData }] }));
    return result;
  }

  /** Như command nhưng ném lỗi nếu broker báo lỗi, trừ các lỗi nằm trong `ignore`. */
  async mustCommand(command: string, args: Record<string, unknown> = {}, ignore: string[] = []) {
    const r = await this.command(command, args);
    if (r.error && !ignore.some((i) => r.error!.toLowerCase().includes(i.toLowerCase()))) {
      throw new Error(`Dynsec ${command}: ${r.error}`);
    }
    return r;
  }
}
