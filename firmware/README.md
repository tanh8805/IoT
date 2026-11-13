# Firmware ESP32

Sketch Arduino nằm ở `smart_watering/`. Board: ESP32 DevKit (`esp32:esp32:esp32`).

| File | Vai trò |
|---|---|
| `smart_watering.ino` | `setup()` và vòng lặp chính, đọc cảm biến mỗi 10 giây |
| `config.h` | ID thiết bị, phiên bản, chân nối, hiệu chuẩn, ngưỡng và thời gian |
| `sensors.h` | Đọc độ ẩm đất và ánh sáng BH1750 |
| `actuators.h` | Điều khiển bơm (qua relay) và servo màn che |
| `automation.h` | Logic tự tưới và tự kéo màn, chạy ngay trên ESP32 |
| `net.h` | WiFi, OTA, MQTT, nhận lệnh/cấu hình, gửi telemetry |
| `secrets.example.h` | Mẫu cấu hình bí mật |

## Thư viện cần cài

Cài trong Arduino IDE (Library Manager) hoặc bằng `arduino-cli lib install`:

- **PubSubClient** (Nick O'Leary)
- **ArduinoJson**, bản **7.x** (code dùng `JsonDocument`, không chạy với bản 6)
- **BH1750** của *Christopher Laws*
- **ESP32Servo**

Ngoài ra cần cài board package **esp32 by Espressif Systems** trong Boards Manager.

## Tạo secrets.h

`secrets.h` chứa mật khẩu WiFi, MQTT, OTA nên bị `.gitignore` chặn, không được commit.

```bash
cd firmware/smart_watering
cp secrets.example.h secrets.h
```

Rồi sửa `secrets.h`:

| Macro | Điền |
|---|---|
| `WIFI_SSID`, `WIFI_PASS` | WiFi 2,4 GHz (ESP32 không bắt được 5 GHz) |
| `MQTT_HOST` | IP của máy chạy Mosquitto (xem `deployment/README.md`) |
| `MQTT_USER` | `chau-01` |
| `MQTT_PASS` | Mật khẩu của user `chau-01` trong `.env` ở gốc repo |
| `OTA_PASS` | Mật khẩu tự đặt, dùng khi nạp qua WiFi |

## Nạp code

**Lần đầu: qua USB.** Mở `smart_watering/smart_watering.ino`, chọn board *ESP32 Dev Module* và cổng USB (thường `/dev/ttyUSB0`), rồi nạp. Nếu bị `Permission denied` trên Linux thì thêm user vào nhóm `dialout` (Fedora) rồi đăng nhập lại:

```bash
sudo usermod -aG dialout $USER
```

Mở Serial Monitor ở 115200 baud. Khi thấy `WiFi OK, IP: ...` và `MQTT da ket noi` là thiết bị đã lên mạng.

**Các lần sau: qua WiFi (OTA).** Máy tính và ESP32 phải cùng mạng. Trong Arduino IDE vào *Tools → Port*, chọn **`chau-01 at <IP>`** trong mục Network ports, nạp như bình thường và nhập `OTA_PASS` khi được hỏi.

## Tăng FW_VERSION

Mỗi lần nạp bản mới, tăng `FW_VERSION` trong `config.h` (ví dụ `1.0.0` thành `1.0.1`). Giá trị này được gửi trong trường `fw` của telemetry để backend theo dõi thiết bị đang chạy bản nào.

## Lưu ý khi chạy

- Logic tưới và che nắng chạy trên ESP32 nên mất mạng vẫn hoạt động; ngưỡng cấu hình được lưu trong flash.
- Lệnh có `cmd_id` trùng với lệnh vừa xử lý sẽ không thực hiện lại, thiết bị chỉ trả ack `"ok"` với `msg` là `"duplicate"`.
- Sơ đồ nối dây ở `../hardware/README.md`.
