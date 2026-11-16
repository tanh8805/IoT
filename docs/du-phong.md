# Bản dự phòng: backend, frontend, database

Bản này chỉ nằm trên máy cá nhân, thêm phần backend, frontend, database cho đồ án để có điểm quay lại khi cần. Firmware không bị sửa; backend khớp đúng định dạng bản tin `net.h` đang gửi. Remote `origin` của thư mục này đã khóa push (`git remote -v` cho thấy push là `DISABLED`).

## 1. Thành phần và cổng

Dùng tên container và cổng khác bản gốc (cổng broker gốc là 1883) nên chạy song song được.

| Dịch vụ | Container | Cổng trên máy | Ghi chú |
|---|---|---|---|
| Mosquitto 2 + Dynamic Security | `sw-dp-mosquitto` | **1884** | tài khoản/ACL do backend quản lý |
| PostgreSQL 16 | `sw-dp-postgres` | **5433** | dữ liệu trong volume `pgdata` |
| Backend NestJS | `sw-dp-backend` | **3001** | API `/api`, socket.io `/socket.io` |
| Frontend (nginx) | `sw-dp-frontend` | **8081** | proxy `/api` và `/socket.io` sang backend |

## 2. Chạy

Cần Docker Desktop (WSL2) và Node.js (chỉ để chạy script tạo `.env` và test).

```bash
node deployment/scripts/init-env.mjs      # tạo .env với mật khẩu ngẫu nhiên (không ghi đè nếu đã có)
cd deployment
docker compose up -d --build              # lần đầu cần --build
```

Mở http://localhost:8081. Dừng: `docker compose down` (giữ dữ liệu); xóa sạch dữ liệu để dựng lại từ đầu: `docker compose down -v`.

`docker compose up -d` tự làm: tạo file Dynamic Security với user quản trị (`mosquitto-init`) → chạy broker → chạy migration và seed → backend nối broker, tạo role/tài khoản cho `chau-01`, `chau-02` rồi mới subscribe topic. Lần đầu backend có một lần nối lại broker (do broker ngắt client vừa được gán role), bình thường.

## 3. Tài khoản mẫu (seed)

Mật khẩu mẫu chỉ để thử nghiệm.

| Tên đăng nhập | Mật khẩu | Vai trò | Thiết bị |
|---|---|---|---|
| `admin` | `Admin@123` | admin | tất cả |
| `operator` | `Operator@123` | operator | `chau-01`, `chau-02` |
| `viewer` | `Viewer@123` | viewer | `chau-01`, `chau-02` |

Thiết bị mẫu: `chau-01` (ESP32 thật) và `chau-02` (giả lập), bắt đầu ở trạng thái PROVISIONED, thành ACTIVE khi gửi dữ liệu đầu tiên.

## 4. Thiết bị giả `chau-02`

Dùng `tests/integration/fake_device.py` (đúng định dạng firmware). Máy không có Python thì chạy trong container cùng mạng compose (lệnh chạy ở gốc repo, bash/PowerShell đều dùng được nếu thay `$PWD` bằng đường dẫn tuyệt đối):

```bash
docker run -d --name sw-dp-fake-device --network smart-watering-dp_default \
  -v "$PWD/tests/integration:/repo/tests/integration:ro" -v "$PWD/.env:/repo/.env:ro" \
  -e MQTT_HOST=mosquitto -e MQTT_PORT=1883 -w /repo/tests/integration python:3.12-slim \
  sh -c "pip install -q -r requirements.txt && python -u fake_device.py --interval 10"
```

Có Python trên máy thì chạy thẳng (`MQTT_HOST=localhost`, `MQTT_PORT=1884` đã có sẵn trong `.env`): `cd tests/integration && python fake_device.py`.

## 5. Cho ESP32 thật (`chau-01`) kết nối

1. Mật khẩu MQTT của `chau-01` là `MQTT_DEVICE_PASS` trong `.env`. `init-env.mjs` lấy nó từ `firmware/smart_watering/secrets.h` (`MQTT_PASS`) nếu file đó có sẵn khi chạy script. Nếu `.env` được tạo khi chưa có `secrets.h` (mật khẩu ngẫu nhiên), đồng bộ bằng một trong hai cách:
   - Sửa `MQTT_DEVICE_PASS` trong `.env` thành `MQTT_PASS` của firmware, rồi `docker compose up -d --force-recreate backend` (backend đặt lại mật khẩu của `chau-01` trên broker khi khởi động); hoặc
   - Sửa `MQTT_PASS` trong `secrets.h` thành `MQTT_DEVICE_PASS` rồi nạp lại firmware.
2. Trong `firmware/smart_watering/secrets.h`:
   ```c
   #define MQTT_HOST "192.168.x.x"   // IP LAN của máy chạy docker compose (không dùng localhost)
   #define MQTT_PORT 1884            // bản dự phòng map broker ra cổng 1884
   #define MQTT_USER "chau-01"
   ```
   Nếu dừng bản gốc và cho bản dự phòng dùng cổng 1883 thì đổi `1884:1883` thành `1883:1883` trong `deployment/docker-compose.yml` và giữ `MQTT_PORT 1883`.
3. Mở cổng 1884/tcp trong tường lửa máy chạy broker (Windows: `New-NetFirewallRule -DisplayName "MQTT dự phòng" -Direction Inbound -Protocol TCP -LocalPort 1884 -Action Allow`, chạy bằng quyền admin).
4. Nạp firmware như `firmware/README.md`. Thiết bị lên ACTIVE khi gửi `status online` hoặc telemetry hợp lệ đầu tiên.

## 6. Phân quyền broker (Dynamic Security)

Backend đăng nhập bằng user quản trị (`MQTT_BACKEND_USER`) và gửi lệnh tới `$CONTROL/dynamic-security/v1`:

- Role `backend-role`: đọc/ghi `devices/#`, gán cho chính user backend.
- Mỗi thiết bị có role `dev-<id>`: publish `devices/<id>/telemetry|status|ack`, nhận và subscribe `devices/<id>/cmd|config` (đúng topic của nó).
- Quyền mặc định của broker là từ chối tất cả.
- Cấp phát → `createClient` (mật khẩu ngẫu nhiên, trả một lần); thu hồi → `disableClient` (broker ngắt và từ chối kết nối).
- File `dynamic-security.json` nằm trong volume Docker `mosq-data` (chỉ chứa hash mật khẩu), không nằm trong repo; `.gitignore` chặn `dynamic-security.json`, `.env`, `secrets.h`.

Các file `mosquitto.static.conf`, `acl`, `create-users.sh` của bản gốc được giữ ở `deployment/mosquitto/legacy/` để tham khảo, bản dự phòng không dùng chúng.

## 7. API chính

Tất cả dưới `/api`, trừ `/auth/login` và `/health` đều cần `Authorization: Bearer <token>`. Quyền kiểm ở backend bằng guard.

| Phương thức, đường dẫn | Quyền | Mô tả |
|---|---|---|
| `POST /auth/login` | công khai | trả `accessToken` (JWT HS256, mặc định 8 giờ) |
| `GET /auth/me` | đã đăng nhập | thông tin người dùng hiện tại |
| `GET /devices`, `GET /devices/:id` | đã đăng nhập | non-admin chỉ thấy thiết bị được gán (403 nếu không được gán) |
| `GET /devices/:id/telemetry?from=&to=&limit=` | đã đăng nhập | lịch sử số đo, lọc theo thời gian ISO 8601 |
| `GET /devices/:id/commands`, `/config-history`, `/state-history` | đã đăng nhập | lịch sử lệnh (kèm kết quả ack), đổi ngưỡng, chuyển trạng thái |
| `POST /devices/:id/commands` | admin, operator | `{action, duration_s?}`: `pump_on` (1–15 giây), `pump_off`, `curtain_open`, `curtain_close`; PENDING → OK/ERROR/TIMEOUT (10 giây) |
| `POST /devices/:id/config` | admin, operator | `{soil_threshold 5–95, lux_close, lux_open}` (`lux_open < lux_close`) |
| `GET /alerts?status=&deviceId=` | đã đăng nhập | cảnh báo (theo thiết bị được gán) |
| `POST /alerts/:id/ack` | admin, operator | xác nhận cảnh báo, ghi người và thời gian |
| `POST /devices` | admin | đăng ký thiết bị → REGISTERED |
| `POST /devices/:id/provision` | admin | tạo tài khoản MQTT → PROVISIONED, trả mật khẩu một lần |
| `POST /devices/:id/maintenance` | admin | `{enabled}` bật/tắt bảo trì |
| `POST /devices/:id/decommission` | admin | thu hồi, vô hiệu tài khoản MQTT |
| `GET/POST /users`, `PATCH /users/:id`, `PUT /users/:id/devices` | admin | thêm, sửa, khóa người dùng, gán thiết bị |
| `GET /audit-logs`, `GET /ingest-errors` | admin | nhật ký hoạt động, bản tin MQTT bị từ chối |

Realtime: socket.io tại cùng cổng, gửi JWT trong `auth.token`; sự kiện `telemetry`, `device`, `alert`, `command` chỉ tới người được xem thiết bị đó.

## 8. Quy tắc nghiệp vụ

- **Vòng đời:** REGISTERED → PROVISIONED → ACTIVE ⇄ OFFLINE/FAULT → MAINTENANCE → DECOMMISSIONED (cuối cùng, không quay lại), lưu lịch sử chuyển trạng thái. ACTIVE khi nhận `status online` hoặc telemetry hợp lệ. OFFLINE khi nhận `status offline` (Last Will) hoặc quá 35 giây không có dữ liệu. FAULT khi số đo vô lý (lux > 65535 hoặc `soil_pct` lệch quá 15 so với `soil_raw`).
- **Bảo trì:** từ chối lệnh và cấu hình (409), không sinh cảnh báo. **Thu hồi:** bỏ qua mọi dữ liệu.
- **Điều khiển:** chỉ khi ACTIVE hoặc FAULT; OFFLINE/MAINTENANCE/DECOMMISSIONED/chưa hoạt động trả 409.
- **Telemetry:** kiểm kiểu và khoảng (`soil_raw` 0–4095, `soil_pct` 0–100, `lux` ≥ 0 hoặc null, `ts` null/lệch xa thì dùng giờ server); sai thì từ chối, ghi bảng `IngestError`, sinh cảnh báo ABNORMAL_DATA.
- **Cảnh báo:** đất dưới 20% (LOW_SOIL, dưới 10% là CRITICAL), `auto_blocked` (AUTO_BLOCKED), thiết bị offline (DEVICE_OFFLINE), dữ liệu bất thường (ABNORMAL_DATA). Mới → Đã xác nhận → Đã hết (tự đóng khi điều kiện hết). Không tạo trùng khi đã có cảnh báo cùng loại chưa đóng.
- **Audit:** đăng nhập (kể cả thất bại), gửi lệnh, đổi cấu hình, đổi trạng thái thiết bị, thêm/sửa/khóa người dùng, gán thiết bị, xác nhận cảnh báo, truy cập bị từ chối.

## 9. Giới hạn đã biết

- Mật khẩu người dùng băm bằng `bcryptjs` (cùng thuật toán bcrypt, bản thuần JavaScript để không phải biên dịch native trong Docker).
- Chưa thử với ESP32 thật; mọi kiểm thử dùng thiết bị giả (xem `docs/demo-checklist.md`).
- Chưa có giới hạn tốc độ đăng nhập, HTTPS/TLS cho MQTT và web (chỉ phù hợp mạng LAN thử nghiệm).
- Lịch sử telemetry trả về tối đa 5000 điểm mỗi lần, chưa gộp mẫu cho khoảng thời gian dài.
- Người dùng được gán thêm thiết bị khi đang mở dashboard cần tải lại trang để nhận realtime của thiết bị mới.
