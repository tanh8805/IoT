# Checklist 10 bước demo (bản dự phòng)

Kết quả chạy thật ngày 16/11/2026 bằng `node tests/backend/demo-check.mjs` trên hệ thống dựng từ volume trống bằng `docker compose up -d`, thiết bị giả `chau-02` đang chạy. Toàn văn: `tests/backend/last-demo-run.txt`. Kết quả tự động: **11/11 mục đạt**.

Chưa kiểm với ESP32 `chau-01` thật (xem giới hạn cuối trang). Giao diện web đã mở thử bằng trình duyệt với tài khoản operator: trang chi tiết `chau-02` hiện số đo và biểu đồ cập nhật.

| # | Bước | Kết quả | Bằng chứng (từ lần chạy thật) |
|---|---|---|---|
| 1 | Đăng nhập các vai trò | Đạt | Vai trò ADMIN/OPERATOR/VIEWER; số thiết bị thấy được 3/2/2 (admin thấy cả thiết bị tạm của test, operator và viewer chỉ thấy 2 thiết bị được gán) |
| 2 | Kích hoạt thiết bị | Đạt | Lịch sử REGISTERED → PROVISIONED → ACTIVE; mật khẩu MQTT chỉ trả một lần (cấp phát lần hai = 409); ACTIVE khi nhận `status online` |
| 3 | Thiết bị gửi dữ liệu | Đạt | 3 bản ghi telemetry trong 30 giây từ `chau-02`, lưu PostgreSQL |
| 4 | Dashboard realtime | Đạt | Socket.io: operator và viewer cùng nhận sự kiện `telemetry` của `chau-02`; socket có token sai bị ngắt |
| 5 | Gửi lệnh và nhận ack | Đạt | `pump_on` (2 giây), `curtain_close`, `curtain_open`, `pump_off` đều chuyển PENDING → OK theo ack của thiết bị |
| 6 | Đổi cấu hình | Đạt | Bản tin `{"soil_threshold":45,"lux_close":12000,"lux_open":6000}` tới đúng topic `devices/chau-02/config`; có lịch sử đổi (người đổi: operator); `soil_threshold=99` bị 400 |
| 7 | Ngắt kết nối → offline | Đạt | `docker kill` thiết bị giả → OFFLINE qua Last Will; cảnh báo DEVICE_OFFLINE (CRITICAL); lệnh tới thiết bị offline bị 409; chạy lại → ACTIVE, cảnh báo tự đóng |
| 7b | Im lặng quá 35 giây → offline | Đạt | `docker pause` thiết bị giả → OFFLINE sau 40 giây (lý do ghi trong lịch sử: "Quá 35 giây không có dữ liệu"; watchdog quét mỗi 5 giây) |
| 8 | Kích hoạt cảnh báo | Đạt | Gửi 2 lần telemetry đất 10% và `auto_blocked=true` → đúng 1 cảnh báo LOW_SOIL và 1 AUTO_BLOCKED (không trùng); operator xác nhận → ACKNOWLEDGED kèm người và thời gian; viewer xác nhận = 403 |
| 9 | Thao tác không có quyền bị chặn | Đạt | viewer gửi lệnh = 403; viewer đổi cấu hình = 403; operator tạo thiết bị = 403; viewer xem người dùng = 403; không token = 401; mỗi lần bị chặn ghi `ACCESS_DENIED` vào audit log |
| 10 | Decommission → không kết nối được | Đạt | Kết nối đang mở bị broker ngắt; kết nối lại bị từ chối (`Connection refused: Not authorized`); lệnh điều khiển tới thiết bị thu hồi = 409 |

## Cách chạy lại

```bash
cd deployment && docker compose up -d        # dựng hệ thống
# chạy thiết bị giả chau-02 (xem docs/du-phong.md, mục 4)
cd ../tests/backend && npm install && node demo-check.mjs
```

## Giới hạn đã biết

- Bản dự phòng được kiểm bằng thiết bị giả. Chưa thử ESP32 thật, và máy dựng bản này không có `firmware/smart_watering/secrets.h`, nên mật khẩu MQTT của `chau-01` là mật khẩu ngẫu nhiên trong `.env` (xem `docs/du-phong.md`, mục 5, để đồng bộ với firmware).
- Bước 7b mất khoảng 40 giây vì phải chờ watchdog; bước 7 dựa vào Last Will nên gần như tức thì.
- Firmware không bị sửa.
