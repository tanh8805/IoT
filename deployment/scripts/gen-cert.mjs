#!/usr/bin/env node
// Tạo chứng chỉ HTTPS tự ký cho nginx: deployment/certs/server.crt + server.key.
// Khóa riêng nằm trong .gitignore, không bao giờ commit.
//
//   node deployment/scripts/gen-cert.mjs                     # localhost, 127.0.0.1
//   node deployment/scripts/gen-cert.mjs 192.168.1.20 may.lan   # thêm IP/tên máy trong LAN
//   node deployment/scripts/gen-cert.mjs --force             # ghi đè chứng chỉ cũ
//
// Dùng openssl trên máy nếu có; không thì chạy openssl trong container (cần Docker).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const certDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'certs');
const args = process.argv.slice(2);
const force = args.includes('--force');
const extra = args.filter((a) => !a.startsWith('--'));

if (existsSync(join(certDir, 'server.key')) && !force) {
  console.log(`Đã có chứng chỉ trong ${certDir}. Dùng --force để tạo lại.`);
  process.exit(0);
}
mkdirSync(certDir, { recursive: true });

const isIp = (h) => /^[0-9.]+$/.test(h) || h.includes(':');
const sans = ['DNS:localhost', 'IP:127.0.0.1', ...extra.map((h) => (isIp(h) ? `IP:${h}` : `DNS:${h}`))];
const opensslArgs = (dir) => [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
  '-keyout', `${dir}/server.key`, '-out', `${dir}/server.crt`,
  '-subj', '/CN=localhost/O=Smart Watering (app)',
  '-addext', `subjectAltName=${sans.join(',')}`,
];

const run = (cmd, a) => spawnSync(cmd, a, { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

let r = spawnSync('openssl', ['version'], { encoding: 'utf8' });
if (r.status === 0) {
  console.log(`Dùng ${r.stdout.trim()} trên máy.`);
  r = run('openssl', opensslArgs(certDir));
} else {
  console.log('Không có openssl trên máy, chạy openssl trong container alpine/openssl...');
  r = run('docker', ['run', '--rm', '-v', `${certDir}:/certs`, 'alpine/openssl', ...opensslArgs('/certs')]);
}
if (r.status !== 0) {
  console.error('Không tạo được chứng chỉ.');
  process.exit(1);
}
console.log(`\nĐã tạo ${join(certDir, 'server.crt')} và server.key (SAN: ${sans.join(', ')}).`);
console.log('Trình duyệt sẽ cảnh báo "không an toàn" vì chứng chỉ tự ký; chọn Tiếp tục/Nâng cao để vào https://localhost:8443.');
