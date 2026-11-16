# Hệ thống tưới cây thông minh

Đồ án môn **IoT và Ứng dụng** (PTIT), nhóm 20.

## 1. Giới thiệu

**Đề tài:** Hệ thống tưới cây thông minh.

**Bài toán.** Khi chủ nhà vắng vài ngày, cây trong chậu dễ thiếu nước hoặc bị cháy nắng. Hệ thống đo độ ẩm đất và cường độ ánh sáng, tự tưới khi đất khô, tự kéo màn che khi nắng gắt, và cho phép người dùng theo dõi, điều khiển từ xa qua web.

**Đối tượng sử dụng.** Người trồng cây tại nhà hoặc ban công cần chăm cây khi vắng nhà (user), và người quản trị đăng ký/khóa thiết bị (admin).

**Chức năng chính**
- Đo độ ẩm đất và ánh sáng mỗi 10 giây, gửi lên server.
- Tự tưới theo ngưỡng độ ẩm, tự đóng/mở màn che theo ngưỡng ánh sáng.
- Bơm nước và điều khiển màn che từ xa, thiết bị xác nhận lệnh bằng ack.
- Dashboard web hiển thị số đo và trạng thái thiết bị; chỉnh ngưỡng từ xa.
- Phát hiện thiết bị offline (Last Will) và cảnh báo.
- Đăng nhập, phân quyền, đăng ký và khóa thiết bị.

**Thành viên và phân công**

| Thành viên | MSV | Phụ trách |
|---|---|---|
| Bùi Tuấn Anh | B23DCCN012 | Thiết bị, firmware ESP32, MQTT broker |
| Trịnh Quốc Đạt | B23DCCN152 | Backend NestJS, frontend |

**Giảng viên hướng dẫn:** Kim Ngọc Bách.

## 2. Kiến trúc

```
 ┌───────────────────────────── ESP32 (chau-01) ─────────────────────────────┐
 │  Cảm biến đất LM393 ──┐                                                    │
 │  Cảm biến sáng BH1750 ┴─> Logic tự động ─┬─> Relay ─> Bơm                 │
 │                           (tưới, che nắng)└─> Servo ─> Màn che            │
 └───────────────────────────────────────┬───────────────────────────────────┘
                                         │ WiFi, MQTT (cổng 1883)
                                         ▼
                              Mosquitto (MQTT broker)
                                         │
                                         ▼
                               Backend (NestJS)
                                         │
                                         ▼
                                   PostgreSQL
                                         ▲
                                         │ API
                                    Frontend (web)
```

Logic tưới và che nắng chạy ngay trên ESP32 nên mất mạng thiết bị vẫn tự hoạt động; ngưỡng cấu hình được lưu trong flash. Khi có mạng, thiết bị tự kết nối lại MQTT và gửi tiếp số đo.

**Quy tắc tự động (giá trị mặc định trong `firmware/smart_watering/config.h`)**
- Độ ẩm đất dưới ngưỡng (40%): bơm một đợt 2 giây, chờ 1 phút cho nước thấm rồi đo lại. Sau 5 đợt mà đất vẫn khô thì dừng tự tưới (`auto_blocked`), vì có thể bể cạn hoặc cảm biến tuột.
- Ánh sáng trên 10000 lux liên tục 10 giây thì đóng màn; dưới 5000 lux liên tục 10 giây thì mở màn.

### Topic MQTT

Mỗi thiết bị dùng các topic `devices/<id>/...`, ví dụ `<id>` là `chau-01`.

| Topic | Hướng | Mô tả |
|---|---|---|
| `devices/<id>/telemetry` | thiết bị → server | Số đo, 10 giây/lần |
| `devices/<id>/status` | thiết bị → server | `online` / `offline`, retained, QoS 1. `offline` do broker phát (Last Will) khi thiết bị mất kết nối |
| `devices/<id>/cmd` | server → thiết bị | Lệnh điều khiển |
| `devices/<id>/ack` | thiết bị → server | Xác nhận lệnh |
| `devices/<id>/config` | server → thiết bị | Đổi ngưỡng, thiết bị lưu vào flash |

**telemetry** (`ts` là giờ UNIX, `null` nếu chưa lấy được giờ mạng; `lux` và `curtain` là `null` nếu chưa lắp cảm biến/servo):

```json
{"ts":1794534238,"soil_raw":2412,"soil_pct":44,"lux":12366.6,"pump":false,"curtain":"open","auto_blocked":false,"fw":"1.0.0"}
```

**Đơn vị đo:**

| Trường | Đơn vị / khoảng | Ghi chú |
|---|---|---|
| `soil_raw` | giá trị ADC 12 bit, 0–4095, không có đơn vị | Càng cao càng khô (khô ~3800, ướt ~650) |
| `soil_pct` | phần trăm (%), số nguyên 0–100 | Độ ẩm đất quy đổi từ `soil_raw` |
| `lux` | lux (lx), số thực ≥ 0, cảm biến BH1750 đo tới 65535 | `null` khi chưa lắp hoặc không đọc được cảm biến |
| `pump` | boolean | `true` khi bơm đang chạy |
| `curtain` | `"open"`, `"closed"` hoặc `null` | `null` khi chưa lắp servo |
| `duration_s` (lệnh) | giây, 1–15 | Thời gian chạy bơm |
| `soil_threshold` (config) | phần trăm (%), 5–95 | Tưới khi độ ẩm dưới ngưỡng |
| `lux_close`, `lux_open` (config) | lux (lx) | `lux_open` < `lux_close` |

**Quy tắc timestamp `ts`:**
- `ts` là giờ UNIX tính bằng **giây** (UTC) do thiết bị lấy từ NTP, ví dụ `1794534238`. Không có múi giờ trong số này; múi giờ chỉ áp dụng khi hiển thị.
- Thiết bị chưa đồng bộ được giờ thì gửi `ts: null` (firmware coi giờ nhỏ hơn `1700000000` là chưa có giờ).
- Backend dùng `ts` của thiết bị làm thời điểm đo. Nếu `ts` là `null`, thiếu, nhỏ hơn `1600000000` (đồng hồ chưa chỉnh) hoặc lệch quá 24 giờ về phía tương lai thì dùng **giờ server lúc nhận**. Số nguyên không hợp lệ về kiểu (chuỗi, số thực) thì bản tin bị từ chối.
- Backend luôn ghi thêm `receivedAt` (giờ server lúc nhận) bên cạnh `ts`. Lưu trong PostgreSQL và xuất CSV đều là UTC (ISO 8601, hậu tố `Z`).

**cmd** (`action`: `pump_on`, `pump_off`, `curtain_open`, `curtain_close`; `duration_s` chỉ dùng cho `pump_on`, từ 1 đến 15 giây, mặc định 5):

```json
{"cmd_id":"c-001","action":"pump_on","duration_s":5}
```

**ack** (`result` là `ok` hoặc `error`; `msg` giải thích khi lỗi). Nếu `cmd_id` trùng với lệnh vừa xử lý, thiết bị không làm lại mà trả `"ok"` với `msg` là `"duplicate"`:

```json
{"cmd_id":"c-001","result":"ok","msg":""}
{"cmd_id":"c-001","result":"ok","msg":"duplicate"}
{"cmd_id":"c-002","result":"error","msg":"duration_s phai tu 1 den 15"}
```

**config** (`soil_threshold` giới hạn 5–95; `lux_open` phải nhỏ hơn `lux_close`, nếu không thiết bị tự đặt bằng một nửa `lux_close`; gửi cấu hình cũng mở lại tưới tự động nếu đang `auto_blocked`):

```json
{"soil_threshold":40,"lux_close":10000,"lux_open":5000}
```

### Phân quyền broker

Broker bắt buộc đăng nhập (`allow_anonymous false`). File `deployment/mosquitto/config/acl`:
- User `backend` đọc/ghi `devices/#`.
- Mỗi thiết bị chỉ được ghi `telemetry`, `status`, `ack` và chỉ đọc `cmd`, `config` của topic mang đúng tên đăng nhập của nó (`devices/%u/...`). `chau-02` không thể gửi lệnh hay nghe dữ liệu của `chau-01`.

## 3. Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| `firmware/` | Firmware ESP32 (Arduino), thư viện và cách nạp |
| `backend/` | API NestJS, xử lý telemetry, quản lý thiết bị |
| `frontend/` | Dashboard web React |
| `database/` | Schema, migration, seed PostgreSQL (Prisma) |
| `deployment/` | Docker Compose và cấu hình Mosquitto |
| `hardware/` | Linh kiện, sơ đồ nối dây, ảnh mạch |
| `tests/` | Sketch kiểm tra phần cứng, script tích hợp MQTT, test bảo mật, kế hoạch kiểm thử |
| `docs/` | Báo cáo, slide, tài liệu thiết kế |

## 4. Cài đặt và chạy

```bash
git clone https://github.com/tanh8805/IoT.git iot-smart-watering
cd iot-smart-watering
```

### 4.1 Broker MQTT (`deployment/`)

Cần Docker và Docker Compose.

```bash
cp .env.example .env                       # điền MQTT_HOST và 3 mật khẩu MQTT
./deployment/mosquitto/create-users.sh     # tạo user backend, chau-01, chau-02
sudo firewall-cmd --add-port=1883/tcp --permanent && sudo firewall-cmd --reload   # Fedora
cd deployment && docker compose up -d
```

Chi tiết và cách kiểm tra bằng `mosquitto_sub` ở [deployment/README.md](deployment/README.md).

### 4.2 Firmware (`firmware/`)

Cài thư viện, tạo `secrets.h` từ `secrets.example.h`, biên dịch và nạp qua USB bằng `arduino-cli`. Xem [firmware/README.md](firmware/README.md). Sơ đồ nối dây ở [hardware/README.md](hardware/README.md).

### 4.3 Thiết bị giả và test (`tests/`)

Khi chưa có mạch, dùng thiết bị giả `chau-02` để phát triển backend.

```bash
python3 -m venv .venv
.venv/bin/pip install -r tests/integration/requirements.txt
cd tests/integration
../../.venv/bin/python fake_device.py                       # giữ chạy ở một terminal
../../.venv/bin/python measure_cmd_latency.py --device chau-02
../../.venv/bin/python send_duplicate_cmd.py --device chau-02
cd ../.. && ./tests/security/test_broker_acl.sh             # kiểm tra xác thực và ACL
```

Kế hoạch kiểm thử và kết quả đã chạy ở [tests/README.md](tests/README.md).

### 4.4 Backend và frontend

Xem [docs/du-phong.md](docs/du-phong.md): tạo chứng chỉ HTTPS tự ký một lần bằng `node deployment/scripts/gen-cert.mjs`, rồi chạy cả hệ thống bằng `docker compose up -d` trong `deployment/`. Web chạy HTTPS ở https://localhost:8443 (cổng 8081 tự chuyển sang đó).

## 5. Thư viện bên thứ ba

| Thành phần | Dùng cho | Liên kết |
|---|---|---|
| PubSubClient | MQTT client trên ESP32 | https://github.com/knolleary/pubsubclient |
| ArduinoJson (7.x) | Đóng/mở gói JSON trên ESP32 | https://arduinojson.org |
| BH1750 (Christopher Laws) | Cảm biến ánh sáng | https://github.com/claws/BH1750 |
| ESP32Servo | Điều khiển servo trên ESP32 | https://github.com/madhephaestus/ESP32Servo |
| Eclipse Mosquitto | MQTT broker | https://mosquitto.org |
| paho-mqtt (Python) | Script thiết bị giả và đo kiểm | https://github.com/eclipse-paho/paho.mqtt.python |
