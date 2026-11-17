# Deployment

Chạy cả hệ thống bằng Docker: Mosquitto 2 (Dynamic Security), PostgreSQL 16, backend, frontend.

```
deployment/
├── docker-compose.yml
├── scripts/init-env.mjs     tạo .env với mật khẩu ngẫu nhiên
├── scripts/gen-cert.mjs     tạo chứng chỉ HTTPS tự ký vào certs/ (khóa riêng không commit)
├── certs/                   server.crt, server.key (sinh cục bộ, bị .gitignore chặn)
└── mosquitto/
    ├── init-dynsec.sh       tạo file Dynamic Security với user quản trị (chạy một lần)
    ├── config/mosquitto.conf  listener 1883, bắt buộc đăng nhập, plugin dynamic security
    └── legacy/              cấu hình cũ (password_file + acl), không dùng ở bản này
```

```bash
node deployment/scripts/init-env.mjs     # từ gốc repo, tạo .env
node deployment/scripts/gen-cert.mjs     # tạo chứng chỉ HTTPS tự ký
cd deployment
docker compose up -d --build
docker compose ps
```

Cổng trên máy: broker 1884, PostgreSQL 5433, backend 3001, web HTTPS 8443 (8081 chuyển hướng sang 8443) (khác bản gốc để chạy song song). Tài khoản mẫu: `database/seed.js`.

Tài khoản MQTT của thiết bị do backend tạo trên broker (không còn `create-users.sh`). Dữ liệu broker nằm trong volume `mosq-data`; xóa hết để dựng lại từ đầu: `docker compose down -v`.