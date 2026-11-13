# Phần cứng

Mạch của một thiết bị (`chau-01`): ESP32 đọc độ ẩm đất và ánh sáng, điều khiển bơm qua relay và servo kéo màn che. Chân GPIO khai báo trong `firmware/smart_watering/config.h`.

## Linh kiện

| Linh kiện | Ghi chú |
|---|---|
| ESP32 DevKit 30 chân | Vi điều khiển, cấp nguồn 5V qua USB |
| Cảm biến độ ẩm đất LM393 | Đầu đo 2 chân cắm vào đất, mạch so sánh LM393, dùng ngõ analog AO |
| Relay 1 kênh 5V SRD-05VDC | Có jumper chọn mức kích H/L |
| Bơm chìm mini 5V | Bơm nước tưới cây |
| Cảm biến ánh sáng BH1750 (GY-302) | Giao tiếp I2C, trả về lux |
| Servo MG90S 180° | Kéo màn che nắng |
| Breadboard, dây cắm | |

## Sơ đồ nối dây

Nguồn 5V lấy từ chân **VIN** của ESP32 (khi cắm USB, VIN ra 5V từ cổng USB).

| Module | Chân module | Nối tới ESP32 |
|---|---|---|
| Cảm biến đất LM393 | VCC | D27 |
| | AO | D34 |
| | GND | GND |
| Relay 5V | DC+ | 5V (VIN) |
| | DC- | GND |
| | IN | D14 |
| | Jumper | để ở **L** |
| BH1750 (GY-302) | VCC | D32 |
| | GND | GND |
| | SCL | D33 |
| | SDA | D25 |
| | ADDR | để trống (địa chỉ I2C 0x23) |
| Servo MG90S | Nâu | GND |
| | Đỏ | 5V (VIN) |
| | Cam | D13 |

**Bơm:** nối qua tiếp điểm của relay, không nối thẳng vào ESP32.

| Điểm | Nối tới |
|---|---|
| Relay COM | 5V (VIN) |
| Relay NO | Dây dương (+) của bơm |
| Dây âm (-) của bơm | GND |

Cảm biến đất và BH1750 được cấp điện từ chân GPIO (D27, D32) chứ không cắm thẳng vào nguồn. Firmware chỉ bật D27 trong lúc đo; D32 bật liên tục.

## Ghi chú thiết kế

- **Dùng tiếp điểm NO (thường hở).** Nếu relay mất tín hiệu hoặc mất điện, tiếp điểm hở nên bơm tự tắt, không chạy mãi gây tràn nước.
- **Jumper ở L.** Relay kích khi chân IN bị kéo xuống GND. Firmware bật bơm bằng `OUTPUT LOW` và tắt bằng `INPUT` (thả nổi). Không dùng mức HIGH vì tín hiệu 3,3V của ESP32 không đủ tin cậy để điều khiển mạch kích 5V của relay.
- **Chân relay: D14 thay cho D26.** Ban đầu relay nối vào D26 nhưng lỗ breadboard ở vị trí đó bị hỏng nên chuyển sang D14. Lưu ý D14 có nháy tín hiệu lúc ESP32 khởi động, nên relay có thể kêu một tiếng khi cấp điện hoặc reset. Firmware tắt bơm ngay ở đầu `setup()`.
- **Cảm biến đất chỉ cấp điện lúc đo** (qua D27) để hai chân kim loại ít bị ăn mòn.
- **BH1750 phải đặt ngoài vùng tấm che.** Nếu nằm trong vùng bị che thì khi màn đóng, lux đọc được tụt xuống, màn lại mở ra rồi đóng lại, lặp liên tục.
- **Không cho bơm và servo chạy cùng lúc** vì cùng dùng nguồn 5V từ USB, chạy đồng thời dễ sụt áp (firmware đã xử lý).

## Ảnh mạch

Đặt ảnh mạch thật vào `images/` rồi nhúng vào README bằng `![Mạch thật](images/ten-anh.jpg)`.
