# Test backend

Chỗ để Đạt đặt test API NestJS (ví dụ `*.e2e-spec.ts` hoặc collection Postman/Bruno). Cần phủ ít nhất:

- Đăng nhập: đúng mật khẩu trả token, sai mật khẩu bị từ chối.
- Phân quyền: user thường không gọi được API của admin (đăng ký/khóa thiết bị, quản lý user).
- Token sai hoặc hết hạn bị từ chối (401).
- User không xem được thiết bị, telemetry, lệnh của người dùng khác.
- Thiết bị bị thu hồi/khóa thì dữ liệu gửi lên bị bỏ qua, và lệnh xuống bị từ chối.

Khi chạy được, ghi kết quả vào các bài tương ứng (mã `F`, `S05` đến `S07`) trong `../README.md`.
