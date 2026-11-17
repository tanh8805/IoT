# Database

PostgreSQL 16 qua Prisma.

- `prisma/schema.prisma`: người dùng, thiết bị, gán thiết bị, lịch sử trạng thái, telemetry, lệnh, lịch sử đổi cấu hình, cảnh báo, audit log, lỗi ingest.
- `prisma/migrations/`: migration SQL, chạy bằng `prisma migrate deploy` khi backend khởi động.
- `seed.js`: 3 người dùng mẫu (admin, operator, viewer) và thiết bị `chau-01`, `chau-02`; chạy lại nhiều lần được. Mật khẩu mẫu ở [../docs/backend-frontend.md](../docs/backend-frontend.md).