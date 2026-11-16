# Backend

API NestJS + TypeScript: nhận telemetry từ MQTT, lưu PostgreSQL (Prisma), quản lý vòng đời thiết bị và tài khoản MQTT qua Mosquitto Dynamic Security, JWT + 3 vai trò (admin, operator, viewer), gửi lệnh/cấu hình, cảnh báo, audit log, đẩy realtime qua socket.io.

Mô tả đầy đủ (API, quy tắc nghiệp vụ, cách chạy): [../docs/du-phong.md](../docs/du-phong.md).

```
src/
├── main.ts, app.module.ts, controllers.ts, dto.ts
├── common/     guard JWT + vai trò, kiểm tra quyền xem thiết bị
├── auth/ users/ devices/ commands/ alerts/ audit/
├── mqtt/       kết nối MQTT, gọi Dynamic Security, tạo/vô hiệu tài khoản thiết bị
├── ingest/     kiểm tra và lưu telemetry/status/ack, watchdog 35 giây, timeout lệnh 10 giây
└── realtime/   socket.io gateway
```

Chạy cả hệ thống bằng `docker compose up -d` trong `deployment/`. Biến môi trường: xem `.env.example` ở gốc repo (`JWT_SECRET`, `MQTT_BACKEND_*`, `MQTT_*_DEVICE_*`, `POSTGRES_*`).

Phát triển cục bộ: `npm install`, `npm run prisma:generate`, `npm run typecheck`, `npm run build`.