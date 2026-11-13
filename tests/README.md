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
| F07 | Lệnh màn che và ack | Bấm "Đóng màn" rồi "Mở màn" | Servo quay 90° rồi về 0°, nhận ack `ok` | Chưa có web nên thử qua MQTT: gửi `curtain_close` (`cmd_id` `test-close-002`) lúc 11:26:04, ack `{"result":"ok","msg":""}` về trong cùng giây. Serial in `Man: DONG`, dòng định kỳ đổi thành `man: DONG`. Sau đó lux 167 (dưới 5000) giữ 10 giây nên màn tự mở lại, Serial in `Man: MO`. Góc quay thật của servo chưa được ghi nhận bằng mắt trong bài này. |
| F08 | Phát hiện offline | Rút điện ESP32 | Trong khoảng vài chục giây (keepalive của MQTT), trạng thái thiết bị chuyển offline nhờ Last Will | Rút điện `chau-01` (rút USB). Bản tin cuối lúc 11:34:28, broker phát `offline` (Last Will) lúc 11:35:14, tức 46 giây sau bản tin cuối. Broker coi client chết khi quá 1,5 lần keepalive (30 s) kể từ gói cuối cùng nên khớp với 45 giây. Vì telemetry cách nhau 10 giây, mốc rút điện nằm trong 10 giây sau 11:34:28, độ trễ phát hiện khoảng 36 đến 46 giây. Cắm lại điện: `online` lúc 11:36:17, telemetry đầu tiên lúc 11:36:22. |
| F09 | Cảnh báo | Rút cảm biến đất ra để đất "khô" liên tục; hoặc rút điện ESP32 | Hệ thống tạo cảnh báo (đất khô / `auto_blocked` / thiết bị offline) và hiển thị trên web | |
| F10 | Khóa thiết bị | Admin khóa/thu hồi `chau-01` trên web | Backend bỏ qua dữ liệu từ thiết bị này, không gửi lệnh xuống nữa | |

## Kiểm thử phi chức năng (theo mục 7.2 của đề)

| Mã | Mục tiêu | Cách thực hiện | Kết quả mong đợi | Kết quả thực tế |
|---|---|---|---|---|
| NF01 | Độ trễ lệnh | `measure_cmd_latency.py --device chau-02 -n 20` (thiết bị giả), rồi `--device chau-01` (thiết bị thật) | Mọi lệnh có ack, độ trễ min/trung bình/max được ghi lại để đối chiếu với yêu cầu của đề | Thiết bị thật `chau-01` qua WiFi, 20 lệnh `pump_off`: nhận 20 ack, mất 0. min 7,2 ms / trung bình 15,3 ms / max 76,8 ms (lệnh đầu 76,8 ms, các lệnh sau phần lớn 7 đến 31 ms). Đo từ máy chạy broker, cùng mạng LAN. Thiết bị giả `chau-02` cùng bài: 0,5 / 0,7 / 0,8 ms. |
| NF02 | Tỷ lệ mất bản tin | `measure_telemetry.py --device chau-01 --minutes 30` | Tỷ lệ mất gần 0%, khoảng cách giữa các bản tin xấp xỉ 10 giây | Thiết bị thật `chau-01`, 5 phút (chưa chạy mẫu 30 phút): kỳ vọng 30, nhận 29, mất 3,3% (1 bản, trong sai số ±1 do lệch pha). Khoảng cách giữa các bản tin min 9,93 s / trung bình 10,36 s / max 20,01 s; có đúng 1 khoảng lớn hơn 15 s, tương ứng một bản bị mất. Trong 5 phút đó thiết bị nối lại MQTT 1 lần (broker ghi `session taken over`). Thiết bị giả `chau-02`, 1 phút: 6/6, mất 0%. |
| NF03 | Mất mạng rồi khôi phục | Tắt WiFi/router vài phút trong khi đất khô, bật lại | Trong lúc mất mạng ESP32 vẫn tự tưới (logic chạy trên thiết bị). Khi có mạng lại, tự kết nối lại MQTT, trạng thái về online, telemetry gửi tiếp | |
| NF04 | Bản tin telemetry trùng | Xem cột "bản tin trùng ts" trong `measure_telemetry.py`; kiểm tra DB không có hai bản ghi trùng `ts` | Không có bản tin trùng, hoặc backend loại được bản trùng | `chau-01`, 5 phút (29 bản): 0 bản trùng ts. `chau-02`, 1 phút: 0 bản trùng. Chưa kiểm tra phía backend. |
| NF05 | Lệnh trùng (cùng `cmd_id`) | `send_duplicate_cmd.py --device chau-02`, rồi `--device chau-01` sau khi nạp bản firmware mới | Lần 1 ack `ok`; lần 2 ack `ok` với `msg` là `duplicate` và không thực hiện lại | PASS trên cả thiết bị giả `chau-02` và thiết bị thật `chau-01` (firmware 1.0.7): lần 1 ack `ok`, lần 2 ack `ok` với `msg` là `duplicate`. |
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

- Chạy ngày 13/11/2026 trên Fedora, Mosquitto 2.1.2 trong Docker, Python 3.12, paho-mqtt 2.2.0. Firmware thiết bị: 1.0.7.
- Các bài trên `chau-01` chạy từ máy laptop đang chạy broker, thiết bị nối WiFi cùng mạng LAN. Thiết bị cấp điện qua USB.
- WiFi của thiết bị chập chờn ở nhiều thời điểm khi thử nghiệm: `ping` từng mất 45% đến 87% gói, và broker ghi nhiều lần thiết bị nối lại. Các số đo NF01, NF02 phản ánh điều kiện mạng này, nên cần chạy lại khi mạng ổn định hơn và với mẫu dài hơn (30 phút).
- Số đo của `chau-02` lấy từ thiết bị giả chạy trên cùng máy với broker, chỉ chứng minh script và broker hoạt động đúng, không thay cho số đo với ESP32 thật.
- Bài F08 dùng bản tin cuối cùng làm mốc nên độ trễ có biên sai số 10 giây. Last Will của thiết bị giả cũng đã thử riêng bằng `kill -9`.
- Cổng serial của máy đọc ra dữ liệu bị lặp và lẫn ký tự lạ (nghi cáp USB hoặc cổng), nên các số liệu ở trên lấy từ broker, không từ Serial; riêng F07 có dùng thêm dòng Serial `Man: DONG`.
- Các bài để trống chưa được chạy (các bài cần backend, web, hoặc cần thao tác dài như NF03, NF06).
