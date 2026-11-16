// Chạy 10 bước demo của đề trên hệ thống thật (compose + fake_device chau-02 đang chạy) và in kết quả.
// Cần docker (để ngắt/ chạy lại container thiết bị giả: sw-dp-fake-device).
// Chạy: cd tests/backend && node demo-check.mjs        (mất khoảng 2 phút)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import mqtt from 'mqtt';
import { io } from 'socket.io-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const ORIGIN = process.env.API_ORIGIN || 'http://localhost:3001';
const API = `${ORIGIN}/api`;
const MQTT_URL = `mqtt://localhost:${env.MQTT_PORT || 1884}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (m) => console.log(m);

async function http(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const login = async (u, p) => (await http('POST', '/auth/login', null, { username: u, password: p })).body?.accessToken;
async function until(fn, timeoutMs, stepMs = 500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(stepMs);
  }
}
function mqttConnect(username, password) {
  return new Promise((resolve) => {
    const c = mqtt.connect(MQTT_URL, { username, password, reconnectPeriod: 0, connectTimeout: 5000, clientId: `demo-${randomBytes(4).toString('hex')}` });
    let done = false;
    const fin = (r) => { if (!done) { done = true; if (!r.ok) c.end(true); resolve(r); } };
    c.once('connect', () => fin({ ok: true, client: c }));
    c.once('error', (e) => fin({ ok: false, error: e.message }));
    c.once('close', () => fin({ ok: false, error: 'bị đóng' }));
    setTimeout(() => fin({ ok: false, error: 'hết thời gian' }), 7000);
  });
}
const pub = (c, topic, payload) => new Promise((res) => c.publish(topic, payload, { qos: 1 }, res));
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();
const stateOf = async (t, id) => (await http('GET', `/devices/${id}`, t)).body.state;

async function step(n, name, fn) {
  try {
    const detail = await fn();
    results.push({ n, name, ok: true, detail });
    log(`PASS  ${n}. ${name} :: ${detail}`);
  } catch (e) {
    results.push({ n, name, ok: false, detail: e.message });
    log(`FAIL  ${n}. ${name} :: ${e.message}`);
  }
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

const tmpId = `demo-${randomBytes(3).toString('hex')}`;
let admin, operator, viewer, tmpPass, tmpClient;

await step(1, 'Đăng nhập các vai trò', async () => {
  [admin, operator, viewer] = await Promise.all([login('admin', 'Admin@123'), login('operator', 'Operator@123'), login('viewer', 'Viewer@123')]);
  need(admin && operator && viewer, 'đăng nhập thất bại');
  const roles = [];
  for (const t of [admin, operator, viewer]) roles.push((await http('GET', '/auth/me', t)).body.role);
  const counts = [];
  for (const t of [admin, operator, viewer]) counts.push((await http('GET', '/devices', t)).body.length);
  return `vai trò=${roles.join('/')}; số thiết bị thấy được=${counts.join('/')}`;
});

await step(2, 'Kích hoạt thiết bị (Registered → Provisioned → Active)', async () => {
  const c = await http('POST', '/devices', admin, { id: tmpId, name: 'Thiết bị demo', location: 'demo' });
  need(c.body.state === 'REGISTERED', `trạng thái sau khi tạo: ${c.body.state}`);
  const p = await http('POST', `/devices/${tmpId}/provision`, admin);
  need(p.status === 200 && p.body.mqttPassword, 'cấp phát thất bại');
  tmpPass = p.body.mqttPassword;
  need((await stateOf(admin, tmpId)) === 'PROVISIONED', 'chưa PROVISIONED');
  const conn = await mqttConnect(tmpId, tmpPass);
  need(conn.ok, `thiết bị mới không kết nối được: ${conn.error}`);
  tmpClient = conn.client;
  await pub(tmpClient, `devices/${tmpId}/status`, 'online');
  const active = await until(async () => (await stateOf(admin, tmpId)) === 'ACTIVE', 8000);
  need(active, 'không lên ACTIVE sau status online');
  const hist = (await http('GET', `/devices/${tmpId}/state-history`, admin)).body.map((h) => h.to).reverse();
  return `lịch sử: ${hist.join(' → ')}; mật khẩu MQTT chỉ trả về một lần (cấp phát lần 2 = ${(await http('POST', `/devices/${tmpId}/provision`, admin)).status})`;
});

await step(3, 'Thiết bị gửi dữ liệu', async () => {
  const since = new Date(Date.now() - 30_000).toISOString();
  const rows = await until(async () => {
    const r = (await http('GET', `/devices/chau-02/telemetry?from=${encodeURIComponent(since)}`, admin)).body;
    return r.length >= 2 ? r : null;
  }, 30000, 1000);
  need(rows, 'chau-02 chưa gửi telemetry (fake_device.py có chạy không?)');
  const last = rows[rows.length - 1];
  return `${rows.length} bản ghi/30s từ chau-02; mới nhất soil=${last.soilPct}% lux=${last.lux}`;
});

await step(4, 'Dashboard realtime (WebSocket)', async () => {
  const got = {};
  const sockets = [['operator', operator], ['viewer', viewer]].map(([name, token]) => {
    const s = io(ORIGIN, { auth: { token }, transports: ['websocket'] });
    s.on('telemetry', (t) => { got[name] ??= t; });
    return s;
  });
  const bad = io(ORIGIN, { auth: { token: 'rac' }, transports: ['websocket'] });
  let badDisconnected = false;
  bad.on('disconnect', () => { badDisconnected = true; });
  const ok = await until(async () => got.operator && got.viewer, 20000, 250);
  sockets.forEach((s) => s.close());
  await sleep(300);
  bad.close();
  need(ok, 'không nhận được sự kiện telemetry realtime');
  need(badDisconnected, 'socket token sai phải bị ngắt');
  return `operator và viewer nhận telemetry realtime (${got.operator.deviceId}, soil=${got.operator.soilPct}%); socket token sai bị ngắt`;
});

await step(5, 'Gửi lệnh và nhận ack', async () => {
  const out = [];
  for (const body of [{ action: 'pump_on', duration_s: 2 }, { action: 'curtain_close' }, { action: 'curtain_open' }, { action: 'pump_off' }]) {
    const r = await http('POST', '/devices/chau-02/commands', operator, body);
    need(r.status === 201, `gửi ${body.action} lỗi ${r.status}`);
    const done = await until(async () => {
      const c = (await http('GET', '/devices/chau-02/commands', operator)).body.find((x) => x.id === r.body.id);
      return c && c.status !== 'PENDING' ? c : null;
    }, 11000);
    need(done && done.status === 'OK', `${body.action}: ${done ? done.status : 'không có ack'}`);
    out.push(`${body.action}=OK`);
  }
  return out.join(', ');
});

await step(6, 'Đổi cấu hình', async () => {
  const sub = await mqttConnect(env.MQTT_BACKEND_USER, env.MQTT_BACKEND_PASS);
  need(sub.ok, `không nối được với user backend: ${sub.error}`);
  let received;
  sub.client.on('message', (t, m) => { if (t === 'devices/chau-02/config') received = JSON.parse(m.toString()); });
  await new Promise((r) => sub.client.subscribe('devices/chau-02/config', { qos: 1 }, r));
  const r = await http('POST', '/devices/chau-02/config', operator, { soil_threshold: 45, lux_close: 12000, lux_open: 6000 });
  need(r.status === 200, `đổi cấu hình lỗi ${r.status} ${JSON.stringify(r.body)}`);
  await until(async () => received, 5000, 200);
  sub.client.end(true);
  need(received && received.soil_threshold === 45 && received.lux_open === 6000, 'bản tin config không tới broker đúng nội dung');
  const hist = (await http('GET', '/devices/chau-02/config-history', operator)).body;
  need(hist.length > 0 && hist[0].username === 'operator', 'chưa có lịch sử đổi cấu hình');
  const bad = await http('POST', '/devices/chau-02/config', operator, { soil_threshold: 99 });
  need(bad.status === 400, `soil_threshold=99 phải bị 400, nhận ${bad.status}`);
  return `config publish: ${JSON.stringify(received)}; lịch sử có ${hist.length} bản ghi (người đổi=${hist[0].username}); soil_threshold=99 bị 400`;
});

await step(7, 'Ngắt kết nối → offline', async () => {
  docker('kill', 'sw-dp-fake-device');
  const off = await until(async () => (await stateOf(admin, 'chau-02')) === 'OFFLINE', 15000, 500);
  need(off, 'chau-02 không chuyển OFFLINE sau khi bị kill (Last Will)');
  const alert = await until(async () => (await http('GET', '/alerts?deviceId=chau-02', admin)).body.find((a) => a.type === 'DEVICE_OFFLINE' && a.status === 'NEW'), 5000);
  need(alert, 'không có cảnh báo DEVICE_OFFLINE');
  const cmd = await http('POST', '/devices/chau-02/commands', operator, { action: 'pump_off' });
  need(cmd.status === 409, `lệnh tới thiết bị offline phải bị 409, nhận ${cmd.status}`);
  const hist = (await http('GET', '/devices/chau-02/state-history', admin)).body[0];
  docker('start', 'sw-dp-fake-device');
  const back = await until(async () => (await stateOf(admin, 'chau-02')) === 'ACTIVE', 40000, 1000);
  need(back, 'chau-02 không trở lại ACTIVE sau khi chạy lại');
  const resolved = await until(async () => !(await http('GET', '/alerts?deviceId=chau-02&status=NEW', admin)).body.some((a) => a.type === 'DEVICE_OFFLINE'), 8000);
  need(resolved, 'cảnh báo offline không tự đóng khi thiết bị trở lại');
  return `OFFLINE qua Last Will (lý do: "${hist.reason}"); cảnh báo DEVICE_OFFLINE #${alert.id} (${alert.severity}); lệnh bị 409; chạy lại → ACTIVE, cảnh báo tự đóng`;
});

await step('7b', 'Quá 35 giây không có telemetry → offline (watchdog)', async () => {
  docker('pause', 'sw-dp-fake-device');
  const t0 = Date.now();
  const off = await until(async () => (await stateOf(admin, 'chau-02')) === 'OFFLINE', 60000, 1000);
  const secs = Math.round((Date.now() - t0) / 1000);
  const hist = (await http('GET', '/devices/chau-02/state-history', admin)).body[0];
  docker('unpause', 'sw-dp-fake-device');
  need(off, 'không chuyển OFFLINE khi thiết bị im lặng');
  await until(async () => (await stateOf(admin, 'chau-02')) === 'ACTIVE', 60000, 1000);
  return `OFFLINE sau ${secs}s im lặng (lý do: "${hist.reason}")`;
});

await step(8, 'Kích hoạt cảnh báo', async () => {
  const conn = await mqttConnect(env.MQTT_FAKE_DEVICE_USER, env.MQTT_FAKE_DEVICE_PASS);
  need(conn.ok, `chau-02 không kết nối: ${conn.error}`);
  const t = { ts: null, soil_raw: 3500, soil_pct: 10, lux: 5000, pump: false, curtain: 'open', auto_blocked: true, fw: 'demo' };
  await pub(conn.client, 'devices/chau-02/telemetry', JSON.stringify(t));
  await pub(conn.client, 'devices/chau-02/telemetry', JSON.stringify(t));
  await sleep(1500);
  conn.client.end(true);
  const list = (await http('GET', '/alerts?deviceId=chau-02&status=NEW', operator)).body;
  const low = list.filter((a) => a.type === 'LOW_SOIL');
  const blocked = list.filter((a) => a.type === 'AUTO_BLOCKED');
  need(low.length === 1, `LOW_SOIL phải có đúng 1 cảnh báo mở (không trùng), có ${low.length}`);
  need(blocked.length === 1, `AUTO_BLOCKED phải có đúng 1, có ${blocked.length}`);
  const v = await http('POST', `/alerts/${low[0].id}/ack`, viewer);
  need(v.status === 403, `viewer xác nhận cảnh báo phải bị 403, nhận ${v.status}`);
  const ack = await http('POST', `/alerts/${low[0].id}/ack`, operator);
  need(ack.body.status === 'ACKNOWLEDGED' && ack.body.ackedByName === 'operator' && ack.body.ackedAt, 'xác nhận không ghi người/thời gian');
  return `LOW_SOIL #${low[0].id} (${low[0].severity}) và AUTO_BLOCKED #${blocked[0].id} tạo đúng 1 bản dù gửi 2 lần; operator xác nhận → ${ack.body.status} lúc ${ack.body.ackedAt}; viewer xác nhận = 403`;
});

await step(9, 'Thao tác không có quyền bị chặn', async () => {
  const checks = {
    'viewer gửi lệnh': (await http('POST', '/devices/chau-02/commands', viewer, { action: 'pump_on' })).status,
    'viewer đổi cấu hình': (await http('POST', '/devices/chau-02/config', viewer, { soil_threshold: 50 })).status,
    'operator tạo thiết bị': (await http('POST', '/devices', operator, { id: 'xx-1', name: 'x' })).status,
    'viewer xem người dùng': (await http('GET', '/users', viewer)).status,
    'không token': (await http('GET', '/devices')).status,
  };
  const expected = [403, 403, 403, 403, 401];
  need(Object.values(checks).every((s, i) => s === expected[i]), `mã trạng thái sai: ${JSON.stringify(checks)}`);
  const audit = (await http('GET', '/audit-logs?action=ACCESS_DENIED&limit=5', admin)).body;
  need(audit.length > 0, 'ACCESS_DENIED chưa vào audit log');
  return `${Object.entries(checks).map(([k, v]) => `${k}=${v}`).join('; ')}; audit ACCESS_DENIED có ${audit.length}+ bản ghi`;
});

await step(10, 'Decommission → thiết bị không kết nối được', async () => {
  const closed = new Promise((r) => tmpClient.once('close', r));
  const dec = await http('POST', `/devices/${tmpId}/decommission`, admin);
  need(dec.status === 200 && dec.body.state === 'DECOMMISSIONED', 'decommission thất bại');
  await Promise.race([closed, sleep(5000)]);
  need(!tmpClient.connected, 'kết nối đang mở không bị ngắt');
  tmpClient.end(true);
  const re = await mqttConnect(tmpId, tmpPass);
  if (re.client) re.client.end(true);
  need(!re.ok, 'broker vẫn cho thiết bị đã thu hồi kết nối');
  const cmd = await http('POST', `/devices/${tmpId}/commands`, admin, { action: 'pump_off' });
  need(cmd.status === 409, `lệnh tới thiết bị thu hồi phải 409, nhận ${cmd.status}`);
  return `kết nối đang mở bị ngắt; kết nối lại bị broker từ chối (${re.error}); lệnh điều khiển = 409`;
});

const failed = results.filter((r) => !r.ok).length;
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'last-demo-run.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
log(`\nTổng: ${results.length - failed}/${results.length} bước đạt`);
process.exit(failed ? 1 : 0);
