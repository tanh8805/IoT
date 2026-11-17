// Test e2e bổ sung: tài khoản người dùng, firmware/phần cứng, thống kê + CSV, HTTPS.
// Cùng điều kiện chạy với e2e.test.mjs (stack docker compose đang chạy, đã gen chứng chỉ HTTPS).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
const API_ORIGIN = API.replace(/\/api$/, '');
const MQTT_URL = process.env.MQTT_URL || `mqtt://localhost:${env.MQTT_PORT || 1884}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Backend giới hạn đăng nhập 5 lần/phút theo IP và tin X-Forwarded-For (trust proxy). Mỗi request giả một IP
// riêng để nhiều lần đăng nhập của bộ test không chạm giới hạn; test giới hạn thật nằm ở nhóm 'Xác thực'.
const fakeIp = () => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;

async function http(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fakeIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const login = async (username, password) => (await http('POST', '/auth/login', null, { username, password })).body.accessToken;

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

const rand = () => randomBytes(3).toString('hex');
async function newUser(role = 'VIEWER', extra = {}) {
  const username = `e2e-u-${rand()}`;
  const password = 'MatKhau#123';
  const r = await http('POST', '/users', admin, { username, password, fullName: 'Người dùng thử', role, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.id, username, password, token: await login(username, password) };
}
const openSocket = (url, token, extra = {}) => io(url, { auth: { token }, transports: ['websocket'], reconnection: false, ...extra });

describe('Tài khoản người dùng', () => {
  test('đăng xuất thu hồi token (kể cả websocket), phiên khác của cùng người vẫn dùng được', async () => {
    const u = await newUser();
    const other = await login(u.username, u.password);
    assert.equal((await http('GET', '/auth/me', u.token)).status, 200);

    const sock = openSocket(API_ORIGIN, u.token);
    await new Promise((res, rej) => {
      sock.once('connect', res);
      sock.once('connect_error', rej);
      setTimeout(() => rej(new Error('socket không nối được')), 5000);
    });
    const dropped = new Promise((res) => sock.once('disconnect', () => res(true)));

    assert.equal((await http('POST', '/auth/logout', u.token)).status, 200);
    assert.equal((await http('GET', '/auth/me', u.token)).status, 401, 'token đã đăng xuất phải bị chặn');
    assert.equal((await http('GET', '/devices', u.token)).status, 401);
    assert.equal(await Promise.race([dropped, sleep(3000).then(() => false)]), true, 'websocket phải bị ngắt sau đăng xuất');
    assert.equal((await http('GET', '/auth/me', other)).status, 200, 'phiên khác chưa đăng xuất vẫn hợp lệ');

    const sock2 = openSocket(API_ORIGIN, u.token);
    const refused = await new Promise((res) => {
      sock2.once('disconnect', () => res(true));
      setTimeout(() => res(false), 4000);
    });
    assert.ok(refused, 'token bị thu hồi không giữ được kết nối websocket');
    sock.close();
    sock2.close();
  });

  test('đổi mật khẩu: sai mật khẩu cũ bị từ chối, đổi xong mọi phiên cũ hết hiệu lực', async () => {
    const u = await newUser();
    const second = await login(u.username, u.password);
    assert.equal((await http('POST', '/auth/change-password', u.token, { currentPassword: 'sai', newPassword: 'MatKhauMoi#1' })).status, 400);
    assert.equal((await http('POST', '/auth/change-password', u.token, { currentPassword: u.password, newPassword: 'ngan' })).status, 400, 'mật khẩu mới < 8 ký tự');
    assert.equal((await http('POST', '/auth/change-password', u.token, { currentPassword: u.password, newPassword: u.password })).status, 400, 'mật khẩu mới phải khác cũ');

    assert.equal((await http('POST', '/auth/change-password', u.token, { currentPassword: u.password, newPassword: 'MatKhauMoi#1' })).status, 200);
    assert.equal((await http('GET', '/auth/me', u.token)).status, 401, 'token đang dùng bị thu hồi');
    assert.equal((await http('GET', '/auth/me', second)).status, 401, 'phiên khác cũng hết hiệu lực');
    assert.equal((await http('POST', '/auth/login', null, { username: u.username, password: u.password })).status, 401, 'mật khẩu cũ không đăng nhập được');
    // Đăng nhập lại ngay trong cùng giây với lúc đổi vẫn phải được chấp nhận.
    const fresh = await login(u.username, 'MatKhauMoi#1');
    assert.equal((await http('GET', '/auth/me', fresh)).status, 200, 'đăng nhập lại bằng mật khẩu mới được');
  });

  test('cập nhật thông tin cá nhân; không tự đổi được vai trò', async () => {
    const u = await newUser('VIEWER');
    const r = await http('PATCH', '/auth/me', u.token, { fullName: 'Tên Mới', email: 'moi@example.com', phone: '0912345678' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.fullName, 'Tên Mới');
    const me = (await http('GET', '/auth/me', u.token)).body;
    assert.equal(me.email, 'moi@example.com');
    assert.equal(me.phone, '0912345678');
    assert.equal((await http('PATCH', '/auth/me', u.token, { email: 'khong-phai-email' })).status, 400);
    assert.equal((await http('PATCH', '/auth/me', u.token, { phone: 'abc' })).status, 400);
    await http('PATCH', '/auth/me', u.token, { role: 'ADMIN', active: false }); // 200 hoặc 400 đều được, miễn không có hiệu lực
    const after = (await http('GET', '/auth/me', u.token)).body;
    assert.equal(after.role, 'VIEWER', 'không được tự nâng quyền');
    const logs = (await http('GET', '/audit-logs?action=PROFILE_UPDATE', admin)).body;
    assert.ok(logs.some((l) => l.username === u.username), 'cập nhật hồ sơ phải có trong audit log');
  });

  test('admin tạo tài khoản kèm email/điện thoại; khóa thì không đăng nhập được, mở khóa đăng nhập lại được', async () => {
    const u = await newUser('OPERATOR', { email: 'a@b.vn', phone: '0987654321' });
    const listed = (await http('GET', '/users', admin)).body.find((x) => x.id === u.id);
    assert.equal(listed.email, 'a@b.vn');
    assert.equal(listed.active, true);

    assert.equal((await http('PATCH', `/users/${u.id}`, admin, { active: false })).status, 200);
    assert.equal((await http('GET', '/auth/me', u.token)).status, 401, 'token cũ của tài khoản bị khóa bị chặn ngay');
    assert.equal((await http('POST', '/auth/login', null, { username: u.username, password: u.password })).status, 401, 'tài khoản khóa không đăng nhập được');

    assert.equal((await http('PATCH', `/users/${u.id}`, admin, { active: true })).status, 200);
    assert.ok(await login(u.username, u.password), 'mở khóa xong đăng nhập lại được');
    const actions = (await http('GET', '/audit-logs?limit=500', admin)).body.filter((l) => l.target === `user:${u.username}`).map((l) => l.action);
    assert.ok(actions.includes('USER_LOCK') && actions.includes('USER_UNLOCK') && actions.includes('USER_CREATE'), actions.join(','));
  });

  test('non-admin không tạo/khóa tài khoản (403); admin không tự khóa mình (400)', async () => {
    const u = await newUser('OPERATOR');
    assert.equal((await http('POST', '/users', u.token, { username: 'x-yz', password: 'MatKhau#123', fullName: 'x', role: 'VIEWER' })).status, 403);
    assert.equal((await http('PATCH', `/users/${u.id}`, u.token, { active: false })).status, 403);
    const meAdmin = (await http('GET', '/auth/me', admin)).body;
    assert.equal((await http('PATCH', `/users/${meAdmin.id}`, admin, { active: false })).status, 400);
  });
});

describe('Firmware, phần cứng, thống kê và CSV', () => {
  // soil_raw khớp công thức quy đổi để số đo không bị coi là vô lý (FAULT).
  const telem = (pct, lux, extra = {}) =>
    JSON.stringify({ ts: null, soil_raw: Math.round(3800 - (pct / 100) * 3150), soil_pct: pct, lux, pump: false, curtain: 'open', auto_blocked: false, fw: '1.0.0', ...extra });
  let id, mq;

  before(async () => {
    id = `e2e-${rand()}`;
    const created = await http('POST', '/devices', admin, { id, name: 'Thiết bị thống kê', hwVersion: 'rev-A' });
    assert.equal(created.status, 201);
    assert.equal(created.body.hwVersion, 'rev-A');
    const prov = await http('POST', `/devices/${id}/provision`, admin);
    mq = await tryMqtt(id, prov.body.mqttPassword);
    assert.ok(mq.ok, mq.error);
  });
  after(async () => {
    mq?.client?.end(true);
    await http('POST', `/devices/${id}/decommission`, admin);
  });

  const pub = (payload) => new Promise((res, rej) => mq.client.publish(`devices/${id}/telemetry`, payload, { qos: 1 }, (e) => (e ? rej(e) : res())));

  test('admin nhập/sửa phiên bản phần cứng; operator không sửa được (403)', async () => {
    assert.equal((await http('PATCH', `/devices/${id}`, admin, { hwVersion: 'rev-B' })).body.hwVersion, 'rev-B');
    assert.equal((await http('PATCH', '/devices/chau-02', operator, { hwVersion: 'x' })).status, 403);
    assert.equal((await http('PATCH', `/devices/${id}`, admin, { hwVersion: 'x'.repeat(40) })).status, 400);
  });

  test('lưu phiên bản firmware từ telemetry và ghi lịch sử mỗi lần đổi (không ghi khi giữ nguyên)', async () => {
    await pub(telem(40, 200)); // fw 1.0.0
    await pub(telem(40, 200)); // vẫn 1.0.0
    await sleep(800);
    await pub(telem(40, 200, { fw: '1.1.0' }));
    await sleep(1200);
    const dev = (await http('GET', `/devices/${id}`, admin)).body;
    assert.equal(dev.fwVersion, '1.1.0');
    assert.equal(dev.hwVersion, 'rev-B');
    const hist = (await http('GET', `/devices/${id}/firmware-history`, admin)).body;
    assert.deepEqual(hist.map((h) => [h.from, h.to]).reverse(), [[null, '1.0.0'], ['1.0.0', '1.1.0']]);
  });

  test('thống kê min/max/trung bình theo giờ và theo ngày, có lọc khoảng thời gian', async () => {
    // 2 bản tin cũ (3 ngày trước) + 2 bản tin hiện tại (30% và 50%); 3 bản tin 40% đã gửi ở bài trước.
    const old = Math.floor(Date.now() / 1000) - 3 * 86400;
    await pub(telem(80, 900, { ts: old }));
    await pub(telem(70, null, { ts: old + 60 }));
    await pub(telem(30, 100));
    await pub(telem(50, 300));
    await sleep(1500);
    const from = new Date(Date.now() - 24 * 3600_000).toISOString();
    const q = (g, f, tz = 'Asia/Ho_Chi_Minh') => http('GET', `/devices/${id}/stats?granularity=${g}&tz=${tz}&from=${encodeURIComponent(f)}`, admin);
    const sum = (b, f) => b.reduce((s, x) => s + f(x), 0);

    const hour = (await q('hour', from)).body;
    assert.equal(hour.granularity, 'hour');
    assert.deepEqual(hour.units, { soil: '%', lux: 'lx' });
    const n = sum(hour.buckets, (x) => x.samples);
    assert.equal(n, 5, 'trong 24 giờ có đúng 5 mẫu (3 bản tin 40% + 30% + 50%)');
    assert.equal(Math.min(...hour.buckets.map((x) => x.soil.min)), 30);
    assert.equal(Math.max(...hour.buckets.map((x) => x.soil.max)), 50);
    assert.equal(Math.min(...hour.buckets.map((x) => x.lux.min)), 100);
    assert.equal(Math.max(...hour.buckets.map((x) => x.lux.max)), 300);
    const avg = sum(hour.buckets, (x) => x.soil.avg * x.samples) / n;
    assert.ok(Math.abs(avg - 40) < 0.5, `độ ẩm trung bình 40%, được ${avg}`); // (40+40+40+30+50)/5 = 40
    assert.ok(hour.buckets.every((b) => new Date(b.start).getUTCMinutes() === 0), 'mốc bắt đầu bucket giờ tròn phút');

    const wide = new Date(Date.now() - 5 * 86400_000).toISOString();
    const day = (await q('day', wide)).body;
    assert.ok(day.buckets.length >= 2, 'khoảng 5 ngày có ít nhất 2 ngày khác nhau');
    assert.equal(Math.max(...day.buckets.map((x) => x.soil.max)), 80);
    assert.equal(sum(day.buckets, (x) => x.samples), 7);
    const oldBucket = day.buckets.find((b) => b.soil.max === 80);
    assert.equal(oldBucket.samples, 2);
    assert.equal(oldBucket.lux.samples, 1, 'lux null không tính vào thống kê lux');
    assert.equal(oldBucket.lux.min, 900);
    assert.equal(oldBucket.soil.avg, 75); // (80+70)/2

    assert.equal((await http('GET', `/devices/${id}/stats?granularity=tuan`, admin)).status, 400);
    assert.equal((await http('GET', `/devices/${id}/stats?tz=Khong/Co`, admin)).status, 400);
    assert.equal((await http('GET', `/devices/${id}/stats?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(from)}`, admin)).status, 400);
    assert.equal((await http('GET', `/devices/${id}/stats`, viewer)).status, 403, 'viewer không được gán thiết bị này');
  });

  test('xuất CSV đúng khoảng thời gian, đủ cột, kiểm quyền và ghi audit', async () => {
    const get = (token, qs) => fetch(`${API}/devices/${id}/telemetry/export${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    const wide = new Date(Date.now() - 5 * 86400_000).toISOString();
    const res = await get(admin, `?from=${encodeURIComponent(wide)}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="telemetry-e2e-/);
    const lines = (await res.text()).replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(lines[0], 'ts_utc,received_at_utc,soil_raw,soil_pct,lux,pump,curtain,auto_blocked,fw');
    assert.equal(lines.length - 1, 7, 'phải có 7 dòng dữ liệu');
    assert.ok(lines.slice(1).every((l) => l.split(',').length === 9));
    assert.ok(lines.slice(1).some((l) => l.includes(',80,900,')), 'có dòng dữ liệu 3 ngày trước (soil 80, lux 900)');
    const tsList = lines.slice(1).map((l) => l.split(',')[0]);
    assert.deepEqual([...tsList].sort(), tsList, 'sắp xếp theo thời gian tăng dần');

    const recent = await get(admin, `?from=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`);
    const recentLines = (await recent.text()).trim().split(/\r?\n/);
    assert.equal(recentLines.length - 1, 5, 'khoảng 1 giờ chỉ có 5 dòng');
    assert.equal((await get(admin, '?from=khong-phai-ngay')).status, 400);
    assert.equal((await get(viewer, '')).status, 403);
    assert.equal((await fetch(`${API}/devices/${id}/telemetry/export`)).status, 401);
    const logs = (await http('GET', '/audit-logs?action=DATA_EXPORT', admin)).body;
    assert.ok(logs.some((l) => l.target === `device:${id}`), 'xuất dữ liệu phải ghi audit');
  });
});

describe('HTTPS cho web', () => {
  const WEB = process.env.WEB_HTTPS || 'https://localhost:8443';
  const req = (url, opts = {}) =>
    new Promise((resolve, reject) => {
      const r = https.request(url, { rejectUnauthorized: false, ...opts }, (res) => {
        const cert = res.socket.getPeerCertificate();
        const tls = res.socket.getProtocol();
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body, cert, tls }));
      });
      r.on('error', reject);
      r.end();
    });

  test('web phục vụ qua HTTPS với chứng chỉ tự ký và proxy được API', async () => {
    const page = await req(WEB + '/');
    assert.equal(page.status, 200);
    assert.match(page.body, /<div id="root">/);
    assert.match(page.tls, /TLSv1\.[23]/);
    assert.match(page.cert.subjectaltname, /DNS:localhost/);
    assert.equal(page.cert.issuer.CN, page.cert.subject.CN, 'tự ký: issuer = subject');
    const health = await req(WEB + '/api/health');
    assert.equal(JSON.parse(health.body).status, 'ok');
  });

  test('trình duyệt/máy khách bắt buộc xác minh sẽ từ chối chứng chỉ tự ký', async () => {
    await assert.rejects(req(WEB + '/', { rejectUnauthorized: true }), /self.signed|SELF_SIGNED|unable to verify/i);
  });

  test('cổng HTTP tự chuyển sang HTTPS', async () => {
    const res = await fetch('http://localhost:8081/some/path?x=1', { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), 'https://localhost:8443/some/path?x=1');
  });

  test('socket.io chạy được trên wss qua HTTPS', async () => {
    const t = await login('operator', 'Operator@123');
    const s = openSocket(WEB, t, { rejectUnauthorized: false });
    await new Promise((res, rej) => {
      s.once('connect', res);
      s.once('connect_error', rej);
      setTimeout(() => rej(new Error('wss không nối được')), 6000);
    });
    s.close();
  });
});
