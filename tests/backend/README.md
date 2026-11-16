# Test backend (bản dự phòng)

Test e2e chạy trên hệ thống thật đang chạy bằng `docker compose` (backend + broker Dynamic Security + postgres), không mock.

| File | Nội dung |
|---|---|
| `e2e.test.mjs` | 17 test (Node `node:test`): đăng nhập sai, token sai/hết hạn, phân quyền 403, user không được gán, telemetry sai định dạng, lệnh/ack, cấu hình, Decommissioned không kết nối được broker |
| `e2e-extra.test.mjs` | 13 test bổ sung: đăng xuất/đổi mật khẩu/hồ sơ/khóa tài khoản, firmware và phần cứng, thống kê giờ/ngày, xuất CSV, HTTPS (cần đã chạy `node deployment/scripts/gen-cert.mjs`) |
| `demo-check.mjs` | Chạy tự động 10 bước demo của đề, in PASS/FAIL từng bước (khoảng 2 phút) |
| `last-e2e-run.txt` | Kết quả thật của lần chạy `npm test` gần nhất |
| `last-demo-run.txt` | Kết quả thật của lần chạy `demo-check.mjs` gần nhất |

## Chạy

Cần: `.env` ở gốc repo, stack đang chạy, và thiết bị giả `chau-02` đang chạy (một số test dùng nó).

```bash
cd tests/backend
npm install
npm test                  # 30 test e2e (e2e.test.mjs + e2e-extra.test.mjs)
node demo-check.mjs       # 10 bước demo (dừng/chạy lại container sw-dp-fake-device)
```

Thiết bị giả `chau-02` (không cần cài Python trên máy host, chạy trong container cùng mạng compose):

```bash
docker run -d --name sw-dp-fake-device --network smart-watering-dp_default \
  -v "$PWD/tests/integration:/repo/tests/integration:ro" -v "$PWD/.env:/repo/.env:ro" \
  -e MQTT_HOST=mosquitto -e MQTT_PORT=1883 -w /repo/tests/integration python:3.12-slim \
  sh -c "pip install -q -r requirements.txt && python -u fake_device.py --interval 10"
```

Biến môi trường tùy chọn: `API_URL` (mặc định `http://localhost:3001/api`), `WEB_HTTPS` (mặc định `https://localhost:8443`), `MQTT_URL` (mặc định `mqtt://localhost:1884`).
