# Firmware ESP32

Sketch Arduino nằm ở `smart_watering/`. Board: ESP32 DevKit (`esp32:esp32:esp32`).

| File | Vai trò |
|---|---|
| `smart_watering.ino` | `setup()` và vòng lặp chính, đọc cảm biến mỗi 10 giây |
| `config.h` | ID thiết bị, phiên bản, chân nối, hiệu chuẩn, ngưỡng và thời gian |
| `sensors.h` | Đọc độ ẩm đất và ánh sáng BH1750 |
| `actuators.h` | Điều khiển bơm (qua relay) và servo màn che |
| `automation.h` | Logic tự tưới và tự kéo màn, chạy ngay trên ESP32 |
| `net.h` | WiFi, MQTT, nhận lệnh/cấu hình, gửi telemetry |
| `secrets.example.h` | Mẫu cấu hình bí mật |

## Thư viện cần cài

Cài trong Arduino IDE (Library Manager) hoặc bằng `arduino-cli lib install`:

- **PubSubClient** (Nick O'Leary)
- **ArduinoJson**, bản **7.x** (code dùng `JsonDocument`, không chạy với bản 6)
- **BH1750** của *Christopher Laws*
- **ESP32Servo**

Ngoài ra cần cài board package **esp32 by Espressif Systems** trong Boards Manager.

## Tạo secrets.h

`secrets.h` chứa mật khẩu WiFi và MQTT nên bị `.gitignore` chặn, không được commit.

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

## Nạp code

Firmware chỉ nạp qua USB. Cắm ESP32 vào máy, rồi từ thư mục `firmware/smart_watering`:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 .
arduino-cli upload  --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 .
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

- Cổng thường là `/dev/ttyUSB0`; kiểm tra bằng `arduino-cli board list`.
- Mỗi lúc chỉ một chương trình dùng được cổng USB. Đóng serial monitor trước khi nạp, nếu không `upload` báo `port is busy`.
- Nếu bị `Permission denied` trên Linux thì thêm user vào nhóm `dialout` (Fedora) rồi đăng nhập lại: `sudo usermod -aG dialout $USER`.
- Dùng Arduino IDE thì mở `smart_watering/smart_watering.ino` và chọn board *ESP32 Dev Module*.

Khi Serial Monitor (115200 baud) hiện `WiFi OK, IP: ...` và `MQTT da ket noi` là thiết bị đã lên mạng.

## Tăng FW_VERSION

Mỗi lần nạp bản mới, tăng `FW_VERSION` trong `config.h` (ví dụ `1.0.0` thành `1.0.1`). Giá trị này được gửi trong trường `fw` của telemetry để backend theo dõi thiết bị đang chạy bản nào.

## Lưu ý khi chạy

- Logic tưới và che nắng chạy trên ESP32 nên mất mạng vẫn hoạt động; ngưỡng cấu hình được lưu trong flash.
- Nếu backend đã gửi ngưỡng qua topic `config` thì giá trị lưu trong flash được ưu tiên hơn giá trị mặc định trong `config.h`. Đổi `config.h` rồi nạp lại không thay được ngưỡng đã lưu.
- Lệnh có `cmd_id` trùng với lệnh vừa xử lý sẽ không thực hiện lại, thiết bị chỉ trả ack `"ok"` với `msg` là `"duplicate"`.
- Sơ đồ nối dây ở `../hardware/README.md`.
