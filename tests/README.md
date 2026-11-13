# Kế hoạch kiểm thử

| Thư mục | Nội dung |
|---|---|
| `firmware/` | 3 sketch Arduino kiểm tra phần cứng: `relay_test`, `servo_test`, `i2c_scan` |
| `integration/` | Script Python: thiết bị giả, đo độ trễ lệnh, đo tỷ lệ mất bản tin, thử lệnh trùng |
| `security/` | `test_broker_acl.sh` kiểm tra xác thực và phân quyền broker |
| `backend/` | Chỗ để test API của backend (Đạt) |

## Chuẩn bị

1. Chạy broker theo `../deployment/README.md` (có `.env` và Mosquitto đang chạy).
2. Cài thư viện cho script Python, từ gốc repo:

   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r tests/integration/requirements.txt
   ```

   (Nếu pip báo `--user install` không dùng được trong venv thì thêm `PIP_USER=0` trước lệnh `pip`.)
3. Script đọc `MQTT_HOST` và mật khẩu từ `.env` ở gốc repo.

Các lệnh dưới đây giả định đang ở `tests/integration/` và dùng `../../.venv/bin/python`.

## Bài test phần cứng (sketch Arduino)

Mở từng sketch trong `firmware/` bằng Arduino IDE và nạp riêng, không nạp cùng firmware chính.

| Sketch | Kiểm tra | Kỳ vọng |
|---|---|---|
| `relay_test` | Relay trên D14 (jumper L) | Bật 5s rồi tắt 5s, nghe tiếng "tách" và bơm chạy/dừng theo |
| `servo_test` | Servo trên D12 | Quay 0° → 90° → 0° mỗi 2 giây |
| `servo_pin_scan` | Tìm lỗi đường tín hiệu servo | Phát tín hiệu trên D13, D18, D19, D21, D22, D23 cùng lúc; chuyển dây cam lần lượt qua từng chân, servo quay ở chân nào thì chân đó tốt |
| `i2c_scan` | BH1750 trên SDA=D25, SCL=D33 | In `0x23 (BH1750)`. Mức D25/D33 bằng 1 nghĩa là module đã có điện trở kéo lên |
| `bh1750_wire_test` | Tìm dây BH1750 hỏng hoặc lỏng | Mỗi giây in một dòng kết luận. `TOT` nghĩa là cả 4 dây đều ổn. Lắc từng dây để tìm dây chập chờn |

## Bài test tự động

| Bài | Lệnh |
|---|---|
| Thiết bị giả | `python fake_device.py` (giữ chạy ở một terminal) |
| Độ trễ lệnh | `python measure_cmd_latency.py --device chau-02 -n 20` |
| Mất bản tin | `python measure_telemetry.py --device chau-02 --minutes 5` |
| Lệnh trùng | `python send_duplicate_cmd.py --device chau-02` |
| Bảo mật broker | `./tests/security/test_broker_acl.sh` (chạy từ gốc repo) |

Đổi `--device chau-01` để đo trên thiết bị thật. Lệnh đo dùng `pump_off` nên không bật bơm.

## Kiểm thử chức năng (theo mục 7.1 của đề)

| Mã | Mục tiêu | Cách thực hiện | Kết quả mong đợi | Kết quả thực tế |
|---|---|---|---|---|
| F01 | Đăng nhập | Đăng nhập web bằng tài khoản đúng, rồi bằng mật khẩu sai | Đúng: vào dashboard. Sai: báo lỗi, không vào được | |
| F02 | Phân quyền | Đăng nhập bằng user thường, thử mở chức năng của admin (đăng ký, khóa thiết bị) | Bị chặn (403 hoặc ẩn khỏi giao diện) | |
| F03 | Kích hoạt thiết bị | Admin đăng ký thiết bị `chau-01` trên web, bật ESP32 | Thiết bị chuyển sang trạng thái online, hiện trong danh sách | |
| F04 | Nhận telemetry | Để `chau-01` chạy vài phút, kiểm tra bảng telemetry trong DB | Có bản ghi mới khoảng 10 giây một lần, đúng giá trị `soil_pct`, `lux`, `pump`, `curtain` | |
| F05 | Dashboard | Mở dashboard, so số hiển thị với Serial Monitor; nhúng tay vào đất ẩm rồi khô | Số đo cập nhật gần như theo thời gian thực và khớp với thiết bị | |
| F06 | Lệnh bơm và ack | Bấm "Bơm 5 giây" trên web | Bơm chạy đúng 5 giây, web nhận ack `ok` và lệnh chuyển sang đã xác nhận | |
| F07 | Lệnh màn che và ack | Bấm "Đóng màn" rồi "Mở màn" | Servo quay 90° rồi về 0°, nhận ack `ok` | |
| F08 | Phát hiện offline | Rút điện ESP32 | Trong khoảng vài chục giây (keepalive của MQTT), trạng thái thiết bị chuyển offline nhờ Last Will | |
| F09 | Cảnh báo | Rút cảm biến đất ra để đất "khô" liên tục; hoặc rút điện ESP32 | Hệ thống tạo cảnh báo (đất khô / `auto_blocked` / thiết bị offline) và hiển thị trên web | |
| F10 | Khóa thiết bị | Admin khóa/thu hồi `chau-01` trên web | Backend bỏ qua dữ liệu từ thiết bị này, không gửi lệnh xuống nữa | |

## Kiểm thử phi chức năng (theo mục 7.2 của đề)

| Mã | Mục tiêu | Cách thực hiện | Kết quả mong đợi | Kết quả thực tế |
|---|---|---|---|---|
| NF01 | Độ trễ lệnh | `measure_cmd_latency.py --device chau-02 -n 20` (thiết bị giả), rồi `--device chau-01` (thiết bị thật) | Mọi lệnh có ack, độ trễ min/trung bình/max được ghi lại để đối chiếu với yêu cầu của đề | Thiết bị giả `chau-02`, 20 lệnh: nhận 20 ack, mất 0. min 0,5 ms / trung bình 0,7 ms / max 0,8 ms. Đo trên cùng máy với broker nên chưa gồm WiFi và ESP32. Chưa đo trên `chau-01`. |
| NF02 | Tỷ lệ mất bản tin | `measure_telemetry.py --device chau-01 --minutes 30` | Tỷ lệ mất gần 0%, khoảng cách giữa các bản tin xấp xỉ 10 giây | Thiết bị giả `chau-02`, 1 phút: kỳ vọng 6, nhận 6, mất 0%. Khoảng cách 10,00 s ở cả min/trung bình/max. Mẫu quá ngắn và chưa đo trên `chau-01`. |
| NF03 | Mất mạng rồi khôi phục | Tắt WiFi/router vài phút trong khi đất khô, bật lại | Trong lúc mất mạng ESP32 vẫn tự tưới (logic chạy trên thiết bị). Khi có mạng lại, tự kết nối lại MQTT, trạng thái về online, telemetry gửi tiếp | |
| NF04 | Bản tin telemetry trùng | Xem cột "bản tin trùng ts" trong `measure_telemetry.py`; kiểm tra DB không có hai bản ghi trùng `ts` | Không có bản tin trùng, hoặc backend loại được bản trùng | Thiết bị giả `chau-02`, 1 phút: 0 bản trùng ts. Chưa kiểm tra phía backend và thiết bị thật. |
| NF05 | Lệnh trùng (cùng `cmd_id`) | `send_duplicate_cmd.py --device chau-02`, rồi `--device chau-01` sau khi nạp bản firmware mới | Lần 1 ack `ok`; lần 2 ack `ok` với `msg` là `duplicate` và không thực hiện lại | Thiết bị giả `chau-02`: PASS cả hai lần. Chưa chạy trên `chau-01` (firmware mới chưa biên dịch/nạp). |
| NF06 | Chạy liên tục | Cho `chau-01` chạy liên tục 24 giờ, theo dõi telemetry và bộ nhớ | Không treo, không reset ngoài ý muốn, telemetry không đứt quãng | |

## Kiểm thử bảo mật

| Mã | Mục tiêu | Cách thực hiện | Kết quả mong đợi | Kết quả thực tế |
|---|---|---|---|---|
| S01 | Broker từ chối kết nối không mật khẩu | `test_broker_acl.sh` bài 1 | Bị từ chối (not authorised) | PASS (exit 5, "not authorised") |
| S02 | Broker từ chối sai mật khẩu | `test_broker_acl.sh` bài 2 | Bị từ chối | PASS (exit 5, "not authorised") |
| S03 | Thiết bị không ghi vào topic của thiết bị khác | `test_broker_acl.sh` bài 3: `chau-02` publish `devices/chau-01/cmd` | Subscriber `backend` không nhận được tin của `chau-02` | PASS (tin đối chứng gửi hợp lệ vẫn nhận được) |
| S04 | Thiết bị không đọc topic của thiết bị khác | `test_broker_acl.sh` bài 4: `chau-02` subscribe `devices/chau-01/telemetry` | Không nhận được tin nào | PASS (topic của chính `chau-02` vẫn nhận được) |
| S05 | Token sai/hết hạn bị từ chối | Gọi API với token giả và token đã hết hạn (xem `backend/README.md`) | 401 Unauthorized | |
| S06 | User không xem được thiết bị của người khác | Đăng nhập user B, gọi API lấy thiết bị/telemetry của user A | 403 hoặc 404, không lộ dữ liệu | |
| S07 | Thiết bị bị thu hồi không gửi được dữ liệu | Khóa thiết bị (F10) rồi để nó gửi telemetry | Backend không lưu dữ liệu mới và/hoặc broker không cho kết nối | |
| S08 | Không có bí mật trong git | `git ls-files \| grep -E 'secrets\.h$\|^\.env$\|passwd$'` | Không in ra file nào | Không in ra file nào (chạy ngày 13/11/2026) |

## Ghi chú về kết quả đã chạy

- Chạy ngày 13/11/2026 trên Fedora, Mosquitto 2.1.2 trong Docker, Python 3.12, paho-mqtt 2.2.0.
- Các số đo của `chau-02` lấy từ thiết bị giả chạy trên cùng máy với broker, nên chỉ chứng minh script và broker hoạt động đúng. Chúng không thay cho số đo với ESP32 thật qua WiFi (NF01, NF02 trên `chau-01` vẫn cần chạy).
- Last Will của thiết bị giả đã thử: dừng `fake_device.py` bằng `kill -9` thì topic `devices/chau-02/status` chuyển thành `offline` (retained). Đây chưa phải bài F08, vốn cần rút điện ESP32 thật.
- Các bài để trống chưa được chạy.
