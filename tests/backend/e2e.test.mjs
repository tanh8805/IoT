// Test e2e chạy trên hệ thống đang chạy bằng docker compose (backend + broker + postgres).
// Cần: .env ở gốc repo, và thiết bị giả chau-02 đang chạy (tests/integration/fake_device.py)
// cho các bài cần thiết bị trả lời. Chạy: cd tests/backend && npm install && npm test
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import mqtt from 'mqtt';
import { io } from 'socket.io-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const API = process.env.API_URL || 'http://localhost:3001/api';
const MQTT_URL = process.env.MQTT_URL || `mqtt://localhost:${env.MQTT_PORT || 1884}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const login = async (username, password) => (await http('POST', '/auth/login', null, { username, password })).body.accessToken;

// JWT HS256 tự ký để thử token giả / hết hạn
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signJwt(payload, secret) {
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

/** Thử kết nối MQTT: trả về { ok, client } hoặc { ok:false, error }. */
function tryMqtt(username, password) {
  return new Promise((resolve) => {
    const client = mqtt.connect(MQTT_URL, { username, password, reconnectPeriod: 0, connectTimeout: 5000, clientId: `e2e-${randomBytes(4).toString('hex')}` });
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      if (!r.ok) client.end(true);
      resolve(r);
    };
    client.once('connect', () => finish({ ok: true, client }));
    client.once('error', (error) => finish({ ok: false, error: error.message }));
    client.once('close', () => finish({ ok: false, error: 'kết nối bị đóng' }));
    setTimeout(() => finish({ ok: false, error: 'quá thời gian chờ' }), 7000);
  });
}

let admin, operator, viewer;

before(async () => {
  admin = await login('admin', 'Admin@123');
  operator = await login('operator', 'Operator@123');
  viewer = await login('viewer', 'Viewer@123');
  assert.ok(admin && operator && viewer, 'Đăng nhập 3 tài khoản mẫu phải thành công (đã seed chưa?)');
});

describe('Xác thực', () => {
  test('đăng nhập sai mật khẩu bị từ chối (401)', async () => {
    const r = await http('POST', '/auth/login', null, { username: 'admin', password: 'sai-mat-khau' });
    assert.equal(r.status, 401);
    assert.equal(r.body.accessToken, undefined);
  });

  test('đăng nhập sai tên đăng nhập bị từ chối (401)', async () => {
    const r = await http('POST', '/auth/login', null, { username: 'khong-ton-tai', password: 'x' });
    assert.equal(r.status, 401);
  });

  test('không có token bị từ chối (401)', async () => {
    assert.equal((await http('GET', '/devices')).status, 401);
  });

  test('token rác bị từ chối (401)', async () => {
    assert.equal((await http('GET', '/devices', 'abc.def.ghi')).status, 401);
  });

  test('token ký bằng secret sai bị từ chối (401)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = signJwt({ sub: 1, username: 'admin', role: 'ADMIN', iat: now, exp: now + 3600 }, 'secret-khac');
    assert.equal((await http('GET', '/devices', forged)).status, 401);
  });

  test('token hết hạn bị từ chối (401)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = signJwt({ sub: 1, username: 'admin', role: 'ADMIN', iat: now - 7200, exp: now - 3600 }, env.JWT_SECRET);
    assert.equal((await http('GET', '/devices', expired)).status, 401);
    const valid = signJwt({ sub: 1, username: 'admin', role: 'ADMIN', iat: now, exp: now + 3600, jti: randomBytes(8).toString('hex'), tv: 0 }, env.JWT_SECRET);
    assert.equal((await http('GET', '/devices', valid)).status, 200, 'đối chứng: token đúng secret, còn hạn, có jti phải được chấp nhận');
    const noJti = signJwt({ sub: 1, username: 'admin', role: 'ADMIN', iat: now, exp: now + 3600 }, env.JWT_SECRET);
    assert.equal((await http('GET', '/devices', noJti)).status, 401, 'token không có jti (không thu hồi được) bị từ chối');
  });
});

describe('Phân quyền', () => {
  test('viewer gửi lệnh bị 403', async () => {
    const r = await http('POST', '/devices/chau-02/commands', viewer, { action: 'pump_on', duration_s: 3 });
    assert.equal(r.status, 403);
  });

  test('viewer đổi cấu hình bị 403', async () => {
    const r = await http('POST', '/devices/chau-02/config', viewer, { soil_threshold: 50 });
    assert.equal(r.status, 403);
  });

  test('viewer và operator không vào được API quản trị (403)', async () => {
    assert.equal((await http('GET', '/users', viewer)).status, 403);
    assert.equal((await http('GET', '/audit-logs', operator)).status, 403);
    assert.equal((await http('POST', '/devices', operator, { id: 'xx-99', name: 'x' })).status, 403);
  });

  test('người dùng không được gán thiết bị thì không xem được', async () => {
    const username = `e2e_${randomBytes(3).toString('hex')}`;
    const created = await http('POST', '/users', admin, { username, password: 'MatKhau@123', fullName: 'Người thử', role: 'VIEWER' });
    assert.equal(created.status, 201);
    const token = await login(username, 'MatKhau@123');
    const list = await http('GET', '/devices', token);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, [], 'chưa gán thì danh sách rỗng');
    assert.equal((await http('GET', '/devices/chau-02', token)).status, 403);
    assert.equal((await http('GET', '/devices/chau-02/telemetry', token)).status, 403);
    assert.deepEqual((await http('GET', '/alerts', token)).body, []);
    // Gán rồi thì xem được
    const assigned = await http('PUT', `/users/${created.body.id}/devices`, admin, { deviceIds: ['chau-02'] });
    assert.equal(assigned.status, 200);
    assert.equal((await http('GET', '/devices/chau-02', token)).status, 200);
    // Khóa tài khoản thì token cũ cũng vô hiệu
    await http('PATCH', `/users/${created.body.id}`, admin, { active: false });
    assert.equal((await http('GET', '/devices', token)).status, 401);
  });
});

describe('Lệnh và cấu hình', () => {
  test('operator gửi lệnh bơm và nhận ack ok từ thiết bị', async (t) => {
    const dev = await http('GET', '/devices/chau-02', operator);
    if (dev.body.state !== 'ACTIVE') return t.skip('chau-02 không ACTIVE (chưa chạy fake_device.py?)');
    const sent = await http('POST', '/devices/chau-02/commands', operator, { action: 'pump_on', duration_s: 2 });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.status, 'PENDING');
    let final;
    for (let i = 0; i < 20 && !final; i++) {
      await sleep(500);
      const list = await http('GET', '/devices/chau-02/commands', operator);
      const c = list.body.find((x) => x.id === sent.body.id);
      if (c && c.status !== 'PENDING') final = c;
    }
    assert.ok(final, 'phải có ack trong 10 giây');
    assert.equal(final.status, 'OK');
  });

  test('duration_s ngoài 1–15 bị từ chối (400)', async () => {
    const r = await http('POST', '/devices/chau-02/commands', operator, { action: 'pump_on', duration_s: 99 });
    assert.ok([400, 409].includes(r.status));
    if (r.status === 409) return;
    assert.equal(r.status, 400);
  });

  test('cấu hình lux_open >= lux_close bị từ chối (400)', async (t) => {
    const dev = await http('GET', '/devices/chau-02', operator);
    if (dev.body.state !== 'ACTIVE') return t.skip('chau-02 không ACTIVE');
    const r = await http('POST', '/devices/chau-02/config', operator, { lux_close: 1000, lux_open: 2000 });
    assert.equal(r.status, 400);
  });
});

describe('Telemetry', () => {
  test('telemetry sai định dạng bị từ chối và ghi log, không lưu', async () => {
    const before = (await http('GET', '/ingest-errors', admin)).body.length;
    const conn = await tryMqtt(env.MQTT_FAKE_DEVICE_USER, env.MQTT_FAKE_DEVICE_PASS);
    assert.ok(conn.ok, `chau-02 phải kết nối được broker: ${conn.error}`);
    const marker = 77; // soil_raw đánh dấu để tìm lại
    const bad = [
      '{"ts":null,"soil_raw":' + marker + ',"soil_pct":150,"lux":10,"pump":false,"curtain":"open","auto_blocked":false,"fw":"x"}', // soil_pct > 100
      '{"ts":null,"soil_raw":9999,"soil_pct":50,"lux":10,"pump":false,"curtain":"open","auto_blocked":false}', // soil_raw > 4095
      '{"ts":null,"soil_raw":100,"soil_pct":50,"lux":-5,"pump":false,"curtain":"open","auto_blocked":false}', // lux âm
      '{"ts":null,"soil_raw":100,"soil_pct":"cao","lux":1,"pump":false,"curtain":null,"auto_blocked":false}', // sai kiểu
      'day-khong-phai-json',
    ];
    for (const p of bad) conn.client.publish('devices/chau-02/telemetry', p, { qos: 1 });
    await sleep(2500);
    conn.client.end(true);

    const errors = (await http('GET', '/ingest-errors', admin)).body;
    assert.ok(errors.length >= before + bad.length || errors.length === 200, `phải ghi ${bad.length} lỗi mới (trước ${before}, sau ${errors.length})`);
    const reasons = errors.slice(0, bad.length).map((e) => e.reason).join(' | ');
    assert.match(reasons, /soil_pct/);
    assert.match(reasons, /soil_raw/);
    assert.match(reasons, /lux/);
    assert.match(reasons, /JSON/);

    const since = new Date(Date.now() - 60_000).toISOString();
    const rows = (await http('GET', `/devices/chau-02/telemetry?from=${encodeURIComponent(since)}`, admin)).body;
    assert.ok(!rows.some((r) => r.soilRaw === marker || r.soilPct === 150 || r.soilRaw === 9999), 'dữ liệu sai không được lưu');
  });

  test('API lịch sử telemetry lọc theo thời gian', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const empty = await http('GET', `/devices/chau-02/telemetry?from=${encodeURIComponent(future)}`, admin);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, []);
    assert.equal((await http('GET', '/devices/chau-02/telemetry?from=khong-phai-ngay', admin)).status, 400);
  });
});

describe('Vòng đời thiết bị', () => {
  test('thiết bị bị Decommissioned không kết nối được broker', async () => {
    const id = `e2e-${randomBytes(3).toString('hex')}`;
    const created = await http('POST', '/devices', admin, { id, name: 'Thiết bị thử', location: 'test' });
    assert.equal(created.status, 201);
    assert.equal(created.body.state, 'REGISTERED');

    // Registered: chưa có tài khoản MQTT
    const before = await tryMqtt(id, 'bat-ky');
    assert.equal(before.ok, false, 'REGISTERED chưa có tài khoản, broker phải từ chối');

    // Provisioned: có tài khoản, mật khẩu trả về một lần
    const prov = await http('POST', `/devices/${id}/provision`, admin);
    assert.equal(prov.status, 200);
    assert.ok(prov.body.mqttPassword);
    assert.equal((await http('POST', `/devices/${id}/provision`, admin)).status, 409, 'cấp phát lần hai phải bị từ chối');

    const ok = await tryMqtt(id, prov.body.mqttPassword);
    assert.ok(ok.ok, `Provisioned phải kết nối được: ${ok.error}`);
    const closed = new Promise((resolve) => ok.client.once('close', resolve));

    // Thiết bị chỉ được publish topic của chính nó
    const denied = new Promise((resolve) => {
      ok.client.subscribe('devices/chau-01/cmd', { qos: 1 }, (err, granted) => resolve(err || granted[0].qos === 128 ? 'denied' : 'granted'));
    });
    assert.equal(await denied, 'denied', 'không được subscribe cmd của thiết bị khác');

    // Decommission: broker ngắt kết nối và từ chối kết nối mới
    const dec = await http('POST', `/devices/${id}/decommission`, admin);
    assert.equal(dec.status, 200);
    assert.equal(dec.body.state, 'DECOMMISSIONED');
    await Promise.race([closed, sleep(5000)]);
    assert.equal(ok.client.connected, false, 'kết nối đang mở phải bị ngắt');
    ok.client.end(true);

    const after = await tryMqtt(id, prov.body.mqttPassword);
    assert.equal(after.ok, false, 'Decommissioned phải bị broker từ chối kết nối');
    if (after.client) after.client.end(true);
  });

  test('thiết bị đang bảo trì từ chối lệnh điều khiển (409)', async () => {
    const dev = await http('GET', '/devices/chau-02', admin);
    if (dev.body.state !== 'ACTIVE') return;
    assert.equal((await http('POST', '/devices/chau-02/maintenance', admin, { enabled: true })).status, 200);
    try {
      const r = await http('POST', '/devices/chau-02/commands', operator, { action: 'pump_off' });
      assert.equal(r.status, 409);
    } finally {
      await http('POST', '/devices/chau-02/maintenance', admin, { enabled: false });
    }
  });
});
