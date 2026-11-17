import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';

export const DEVICE_TOPICS = ['devices/+/telemetry', 'devices/+/status', 'devices/+/ack'];
export const DYNSEC_TOPIC = '$CONTROL/dynamic-security/v1';
export const DYNSEC_RESPONSE = `${DYNSEC_TOPIC}/response`;

/**
 * Kết nối MQTT của backend. Phát sự kiện:
 *  - 'connect': đã nối broker (mỗi lần nối lại cũng phát)
 *  - 'message': (topic, payload Buffer)
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Mqtt');
  readonly events = new EventEmitter();
  private client: mqtt.MqttClient;

  onModuleInit() {
    const url = process.env.MQTT_URL || 'mqtt://localhost:1883';
    this.client = mqtt.connect(url, {
      username: process.env.MQTT_BACKEND_USER,
      password: process.env.MQTT_BACKEND_PASS,
      clientId: `smart-watering-backend-${process.pid}`,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
      clean: true,
    });
    this.client.on('connect', () => {
      this.logger.log(`Đã nối broker ${url}`);
      this.events.emit('connect');
    });
    this.client.on('reconnect', () => this.logger.warn('Đang nối lại broker...'));
    this.client.on('error', (e) => this.logger.error(`Lỗi MQTT: ${e.message}`));
    this.client.on('message', (topic, payload) => this.events.emit('message', topic, payload));
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  get connected() {
    return !!this.client?.connected;
  }

  subscribe(topics: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.subscribe(topics, { qos: 1 }, (err, granted) => {
        if (err) return reject(err);
        const denied = (granted || []).filter((g) => g.qos === 128);
        if (denied.length) return reject(new Error(`Broker từ chối subscribe: ${denied.map((d) => d.topic).join(', ')}`));
        resolve();
      });
    });
  }

  publish(topic: string, payload: string, qos: 0 | 1 = 1, retain = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client?.connected) return reject(new Error('Backend chưa nối được broker MQTT'));
      this.client.publish(topic, payload, { qos, retain }, (err) => (err ? reject(err) : resolve()));
    });
  }
}
