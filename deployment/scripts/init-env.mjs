// Tạo .env ở gốc repo với mật khẩu ngẫu nhiên. Không ghi đè nếu .env đã có.
// Mật khẩu MQTT của chau-01 lấy từ firmware/smart_watering/secrets.h (MQTT_PASS) nếu file đó có,
// để ESP32 thật vẫn kết nối được. Không có secrets.h thì sinh ngẫu nhiên và báo để nạp lại firmware.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  console.log('.env đã có, giữ nguyên.');
  process.exit(0);
}

const rnd = (n = 12) => randomBytes(n).toString('hex');
let devicePass = rnd();
let fromSecrets = false;
const secretsPath = join(root, 'firmware', 'smart_watering', 'secrets.h');
if (existsSync(secretsPath)) {
  const m = readFileSync(secretsPath, 'utf8').match(/#define\s+MQTT_PASS\s+"([^"]+)"/);
  if (m) {
    devicePass = m[1];
    fromSecrets = true;
  }
}

const pgPass = rnd();
let text = readFileSync(join(root, '.env.example'), 'utf8');
const set = (key, value) => {
  text = text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
};
set('MQTT_BACKEND_PASS', rnd());
set('MQTT_DEVICE_PASS', devicePass);
set('MQTT_FAKE_DEVICE_PASS', rnd());
set('POSTGRES_PASSWORD', pgPass);
set('DATABASE_URL', `postgresql://smartwatering:${pgPass}@localhost:5433/smart_watering`);
set('JWT_SECRET', rnd(32));
writeFileSync(envPath, text, { mode: 0o600 });

console.log('Đã tạo .env');
if (fromSecrets) {
  console.log('MQTT_DEVICE_PASS lấy từ firmware/smart_watering/secrets.h (ESP32 thật kết nối được ngay).');
} else {
  console.log('CHÚ Ý: không thấy secrets.h nên MQTT_DEVICE_PASS (chau-01) được sinh ngẫu nhiên.');
  console.log('Muốn dùng ESP32 thật: đặt MQTT_PASS trong secrets.h đúng bằng MQTT_DEVICE_PASS trong .env rồi nạp lại firmware.');
}
