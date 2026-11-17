#!/usr/bin/env node
// Thiết bị giả bản Node (mặc định chau-02), tương đương fake_device.py cho máy không có Python.
//
// Gửi telemetry đúng định dạng firmware (publishTelemetry trong net.h) mỗi 10 giây, nhận cmd/config
// và trả ack giống handleCmd/handleConfig, có Last Will "offline".
// Ctrl+C gửi "offline" trước khi thoát; muốn thử Last Will thật thì kill -9 tiến trình.
//
// Chạy: cd tests/backend && npm install   (cài thư viện mqtt dùng chung)
//       node ../integration/fake_device.mjs [--interval 10] [--stdin-control]
// --stdin-control: nhận dòng "pause"/"resume" từ stdin để ngừng/tiếp tục gửi telemetry (demo-check.mjs dùng).
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Dùng lại thư viện mqtt đã cài ở tests/backend.
const mqtt = createRequire(join(here, '..', 'backend', 'package.json'))('mqtt');

const FW_VERSION = '1.0.0-fake';
const PUMP_MAX_S = 15;
const SOIL_DRY_RAW = 3800;
const SOIL_WET_RAW = 650;

function loadEnv() {
  const env = {};
  const path = join(here, '..', '..', '.env');
  if (existsSync(path)) {
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  for (const k of Object.keys(env)) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

const env = loadEnv();
for (const k of ['MQTT_FAKE_DEVICE_USER', 'MQTT_FAKE_DEVICE_PASS']) {
  if (!env[k]) {
    console.error(`Thiếu trong .env: ${k} (xem .env.example)`);
    process.exit(1);
  }
}
const argIdx = process.argv.indexOf('--interval');
const intervalS = argIdx > 0 ? Number(process.argv[argIdx + 1]) : 10;
if (!(intervalS > 0)) {
  console.error('--interval phải là số giây > 0');
  process.exit(1);
}

const id = env.MQTT_FAKE_DEVICE_USER;
const url = process.env.MQTT_URL || `mqtt://${env.MQTT_HOST || 'localhost'}:${env.MQTT_PORT || 1884}`;
const topic = (leaf) => `devices/${id}/${leaf}`;

const soilPct = (raw) => Math.max(0, Math.min(100, Math.round(((raw - SOIL_DRY_RAW) * 100) / (SOIL_WET_RAW - SOIL_DRY_RAW))));
const rnd = (a, b) => a + Math.random() * (b - a);

const state = {
  soilRaw: 2400,
  pumpUntil: 0,
  curtain: 'open',
  lastCmdId: '',
  config: { soil_threshold: 40, lux_close: 20000, lux_open: 10000 },
};
const pumpOn = () => Date.now() < state.pumpUntil;

const client = mqtt.connect(url, {
  username: id,
  password: env.MQTT_FAKE_DEVICE_PASS,
  clientId: `${id}-node-${Math.random().toString(16).slice(2, 8)}`,
  keepalive: 30,
  reconnectPeriod: 2000,
  will: { topic: topic('status'), payload: 'offline', qos: 1, retain: true },
});

function ack(cmdId, result, msg = '') {
  const payload = JSON.stringify({ cmd_id: cmdId, result, msg });
  client.publish(topic('ack'), payload, { qos: 0 });
  console.log(`  ack  -> ${payload}`);
}

function handleCmd(doc) {
  const cmdId = doc.cmd_id || '';
  const action = doc.action || '';
  if (cmdId) {
    if (cmdId === state.lastCmdId) return ack(cmdId, 'ok', 'duplicate');
    state.lastCmdId = cmdId;
  }
  if (action === 'pump_on') {
    const s = doc.duration_s ?? 5;
    if (!Number.isInteger(s) || s < 1 || s > PUMP_MAX_S) return ack(cmdId, 'error', 'duration_s phai tu 1 den 15');
    state.pumpUntil = Date.now() + s * 1000;
    ack(cmdId, 'ok');
  } else if (action === 'pump_off') {
    state.pumpUntil = 0;
    ack(cmdId, 'ok');
  } else if (action === 'curtain_open' || action === 'curtain_close') {
    state.curtain = action === 'curtain_close' ? 'closed' : 'open';
    ack(cmdId, 'ok');
  } else {
    ack(cmdId, 'error', 'action khong hop le');
  }
}

function handleConfig(doc) {
  const c = state.config;
  if (Number.isInteger(doc.soil_threshold)) c.soil_threshold = Math.max(5, Math.min(95, doc.soil_threshold));
  for (const k of ['lux_close', 'lux_open']) if (typeof doc[k] === 'number') c[k] = doc[k];
  if (c.lux_open >= c.lux_close) c.lux_open = c.lux_close / 2;
  console.log(`  config moi: ${JSON.stringify(c)}`);
}

client.on('connect', () => {
  client.publish(topic('status'), 'online', { qos: 1, retain: true });
  client.subscribe([topic('cmd'), topic('config')], { qos: 1 });
  console.log(`${id}: đã kết nối ${url}, status=online`);
  sendTelemetry();
});
client.on('error', (e) => console.error(`Lỗi MQTT: ${e.message}`));
client.on('message', (t, buf) => {
  let doc;
  try {
    doc = JSON.parse(buf.toString());
  } catch {
    return;
  }
  console.log(`<- ${t} ${buf.toString()}`);
  if (t === topic('cmd')) handleCmd(doc);
  else if (t === topic('config')) handleConfig(doc);
});

function telemetry() {
  state.soilRaw += pumpOn() ? -rnd(150, 250) : rnd(0, 15);
  state.soilRaw = Math.max(SOIL_WET_RAW, Math.min(SOIL_DRY_RAW, state.soilRaw));
  const raw = Math.trunc(state.soilRaw);
  return {
    ts: Math.floor(Date.now() / 1000),
    soil_raw: raw,
    soil_pct: soilPct(raw),
    lux: Math.round(rnd(8000, 25000) * 10) / 10,
    pump: pumpOn(),
    curtain: state.curtain,
    auto_blocked: false,
    fw: FW_VERSION,
  };
}

let paused = false;
if (process.argv.includes('--stdin-control')) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (s) => {
    for (const line of s.split(/\r?\n/)) {
      if (line.trim() === 'pause') paused = true;
      else if (line.trim() === 'resume') paused = false;
    }
  });
}

function sendTelemetry() {
  if (!client.connected || paused) return;
  const payload = JSON.stringify(telemetry());
  client.publish(topic('telemetry'), payload, { qos: 0 });
  console.log(`-> telemetry ${payload}`);
}

const timer = setInterval(sendTelemetry, intervalS * 1000);

function shutdown() {
  clearInterval(timer);
  client.publish(topic('status'), 'offline', { qos: 1, retain: true }, () => {
    client.end(false, () => {
      console.log('Đã dừng, status=offline');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
