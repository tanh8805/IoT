# Deployment

Chạy hạ tầng của hệ thống bằng Docker. Hiện có **Eclipse Mosquitto 2** (MQTT broker). Service `postgres` và `backend` do Đạt thêm sau, chỗ để sẵn trong `docker-compose.yml`.

```
deployment/
├── docker-compose.yml
└── mosquitto/
    ├── create-users.sh      tạo file passwd từ .env
    └── config/
        ├── mosquitto.conf   listener 1883, bắt buộc đăng nhập, ACL, log ra file
        └── acl              phân quyền topic
```

## Các bước chạy

Chạy từ gốc repo, trừ khi ghi khác.

**1. Tạo `.env` và điền mật khẩu**

```bash
cp .env.example .env
```

Mở `.env`, điền:
- `MQTT_HOST`: IP LAN của máy chạy broker (xem bằng `ip -4 addr`), ví dụ `192.168.1.11`.
- `MQTT_BACKEND_PASS`, `MQTT_DEVICE_PASS`, `MQTT_FAKE_DEVICE_PASS`: mật khẩu tự đặt cho 3 user `backend`, `chau-01`, `chau-02`.

Có thể sinh mật khẩu ngẫu nhiên bằng `openssl rand -hex 12`. `.env` đã bị `.gitignore` chặn.

**2. Tạo user MQTT**

```bash
./deployment/mosquitto/create-users.sh
```

Script đọc `.env` và tạo `deployment/mosquitto/config/passwd` (cũng bị `.gitignore` chặn) cho 3 user:

| User | Dùng cho |
|---|---|
| `backend` | Backend NestJS và các script đo trong `tests/` |
| `chau-01` | Thiết bị thật (điền vào `secrets.h` của firmware) |
| `chau-02` | Thiết bị giả để test (`tests/integration/fake_device.py`) |

Đổi mật khẩu trong `.env` rồi chạy lại script là được; script tự khởi động lại broker nếu nó đang chạy.

**3. Mở cổng firewall (Fedora)**

ESP32 nối tới broker qua mạng LAN nên cổng 1883 phải được mở. Chạy một lần:

```bash
sudo firewall-cmd --add-port=1883/tcp --permanent && sudo firewall-cmd --reload
```

**4. Chạy broker**

```bash
cd deployment
docker compose up -d
docker compose ps
docker compose logs -f mosquitto
```

## Kiểm tra broker

Không cần cài mosquitto trên máy, dùng client có sẵn trong container. Mở hai terminal trong `deployment/`.

Terminal 1 (đăng nhập bằng `backend`, nghe mọi thứ của thiết bị):

```bash
docker compose exec mosquitto mosquitto_sub -h localhost -u backend -P '<MQTT_BACKEND_PASS>' -t 'devices/#' -v
```

Terminal 2 (đóng vai thiết bị `chau-02`, gửi thử một bản tin):

```bash
docker compose exec mosquitto mosquitto_pub -h localhost -u chau-02 -P '<MQTT_FAKE_DEVICE_PASS>' -t 'devices/chau-02/telemetry' -m '{"soil_pct":55}'
```

Terminal 1 phải hiện `devices/chau-02/telemetry {"soil_pct":55}`. Kết nối không mật khẩu hoặc sai mật khẩu phải bị từ chối. Bộ kiểm tra tự động: `tests/security/test_broker_acl.sh`.

## Phân quyền topic

Xem `mosquitto/config/acl`. User `backend` đọc/ghi `devices/#`. Mỗi thiết bị chỉ ghi `telemetry`, `status`, `ack` và chỉ đọc `cmd`, `config` của topic mang đúng tên mình (`devices/<tên đăng nhập>/...`). Vì vậy tên user MQTT của thiết bị phải trùng `DEVICE_ID` trong firmware.

## Lưu ý

- Container chạy bằng uid `1000` (mặc định của user đầu tiên trên Fedora) để đọc được `passwd` và ghi được `data/`, `log/`. Nếu `id -u` của bạn khác, đặt `MOSQ_UID` và `MOSQ_GID` trước khi chạy `create-users.sh` và `docker compose`.
- Chạy `create-users.sh` **trước** `docker compose up`: script tạo sẵn `data/` và `log/` bằng quyền của bạn. Nếu Docker tự tạo chúng thì chúng thuộc root và broker không ghi được.
- Log nằm ở `mosquitto/log/mosquitto.log` và cũng hiện trong `docker compose logs`.
- Dừng broker: `docker compose down`. Dữ liệu retained (trạng thái online/offline) giữ trong `mosquitto/data/`.
