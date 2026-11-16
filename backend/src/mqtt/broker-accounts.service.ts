import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DynsecService } from './dynsec.service';
import { DEVICE_TOPICS, MqttService } from './mqtt.service';

const BACKEND_ROLE = 'backend-role';

/**
 * Quản lý tài khoản MQTT trên broker bằng Dynamic Security:
 *  - khi (nối lại) broker: tạo role cho backend, gán cho chính backend, rồi mới subscribe devices/+/...
 *  - tạo/vô hiệu hóa/xóa tài khoản và role theo từng thiết bị.
 */
@Injectable()
export class BrokerAccountsService implements OnModuleInit {
  private readonly logger = new Logger('BrokerAccounts');

  constructor(
    private readonly mqtt: MqttService,
    private readonly dynsec: DynsecService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const run = () =>
      this.bootstrap().catch((e) => this.logger.error(`Khởi tạo broker thất bại: ${(e as Error).message}`));
    this.mqtt.events.on('connect', run);
    if (this.mqtt.connected) void run();
  }

  roleName(deviceId: string) {
    return `dev-${deviceId}`;
  }

  private async bootstrap() {
    const backendUser = process.env.MQTT_BACKEND_USER!;
    await this.dynsec.listen();

    // Mặc định từ chối mọi thứ; quyền chỉ đến từ role.
    await this.dynsec.mustCommand('setDefaultACLAccess', {
      acls: [
        { acltype: 'publishClientSend', allow: false },
        { acltype: 'publishClientReceive', allow: false },
        { acltype: 'subscribe', allow: false },
      ],
    });

    await this.dynsec.mustCommand('createRole', { rolename: BACKEND_ROLE, textdescription: 'Backend đọc/ghi devices/#' }, ['already exists']);
    for (const acltype of ['publishClientSend', 'publishClientReceive', 'subscribePattern']) {
      await this.dynsec.mustCommand(
        'addRoleACL',
        { rolename: BACKEND_ROLE, acltype, topic: 'devices/#', allow: true, priority: 0 },
        ['already exists', 'ACL with this type and topic'],
      );
    }
    const me = await this.dynsec.mustCommand('getClient', { username: backendUser });
    const roles = ((me.data as { client?: { roles?: { rolename: string }[] } })?.client?.roles || []).map((r) => r.rolename);
    if (!roles.includes(BACKEND_ROLE)) {
      // Broker ngắt kết nối client vừa bị đổi role; backend tự nối lại và bootstrap chạy tiếp từ đầu.
      this.logger.log('Gán role backend cho chính mình; broker sẽ ngắt kết nối một lần rồi backend nối lại');
      try {
        await this.dynsec.command('addClientRole', { username: backendUser, rolename: BACKEND_ROLE });
      } catch {
        /* bị ngắt kết nối là bình thường */
      }
      return;
    }

    await this.mqtt.subscribe(DEVICE_TOPICS);
    this.logger.log('Backend đã subscribe telemetry/status/ack');

    await this.ensureSeedDevices();
  }

  /** Tạo tài khoản MQTT cho chau-01 và chau-02 (mật khẩu lấy từ .env), trừ khi thiết bị đã thu hồi. */
  private async ensureSeedDevices() {
    const seeds = [
      { id: process.env.MQTT_DEVICE_USER, pass: process.env.MQTT_DEVICE_PASS },
      { id: process.env.MQTT_FAKE_DEVICE_USER, pass: process.env.MQTT_FAKE_DEVICE_PASS },
    ];
    for (const s of seeds) {
      if (!s.id || !s.pass) continue;
      const device = await this.prisma.device.findUnique({ where: { id: s.id } });
      if (!device || device.state === 'DECOMMISSIONED' || device.state === 'REGISTERED') continue;
      await this.createAccount(s.id, s.pass);
      this.logger.log(`Đã đảm bảo tài khoản MQTT cho ${s.id}`);
    }
  }

  /** Tạo (hoặc đặt lại mật khẩu) tài khoản MQTT của thiết bị, kèm role chỉ đúng topic của nó. */
  async createAccount(deviceId: string, password: string) {
    const role = this.roleName(deviceId);
    await this.dynsec.mustCommand('createRole', { rolename: role, textdescription: `Thiết bị ${deviceId}` }, ['already exists']);
    const base = `devices/${deviceId}`;
    const acls: Array<[string, string]> = [
      ['publishClientSend', `${base}/telemetry`],
      ['publishClientSend', `${base}/status`],
      ['publishClientSend', `${base}/ack`],
      ['publishClientReceive', `${base}/cmd`],
      ['publishClientReceive', `${base}/config`],
      ['subscribeLiteral', `${base}/cmd`],
      ['subscribeLiteral', `${base}/config`],
    ];
    for (const [acltype, topic] of acls) {
      await this.dynsec.mustCommand('addRoleACL', { rolename: role, acltype, topic, allow: true, priority: 0 }, ['already exists', 'ACL with this type and topic']);
    }
    const created = await this.dynsec.command('createClient', {
      username: deviceId,
      password,
      textname: deviceId,
      roles: [{ rolename: role }],
    });
    if (created.error) {
      if (!created.error.toLowerCase().includes('already exists')) throw new Error(`createClient: ${created.error}`);
      await this.dynsec.mustCommand('setClientPassword', { username: deviceId, password });
      await this.dynsec.mustCommand('addClientRole', { username: deviceId, rolename: role }, ['already']);
      await this.dynsec.mustCommand('enableClient', { username: deviceId });
    }
  }

  /** Vô hiệu hóa tài khoản: broker ngắt kết nối đang mở và từ chối kết nối mới. */
  async disableAccount(deviceId: string) {
    await this.dynsec.mustCommand('disableClient', { username: deviceId }, ['not found']);
  }
}
