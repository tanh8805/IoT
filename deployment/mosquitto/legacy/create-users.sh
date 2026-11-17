#!/usr/bin/env bash
# Tạo lại file mosquitto/config/passwd từ mật khẩu trong .env ở gốc repo.
# Chạy lại nhiều lần được: mỗi lần file passwd được tạo mới hoàn toàn.
set -euo pipefail

cd "$(dirname "$0")/.."          # vào deployment/ để docker compose thấy docker-compose.yml
ENV_FILE="../.env"
PASSWD_IN_CONTAINER="/mosquitto/config/passwd"

if [ ! -f "$ENV_FILE" ]; then
  echo "Không thấy $ENV_FILE. Chạy: cp .env.example .env rồi điền mật khẩu." >&2
  exit 1
fi

env_get() {
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r'
}

# Tạo sẵn data/ và log/ bằng quyền của bạn, để Docker không tự tạo chúng với owner root.
mkdir -p mosquitto/config mosquitto/data mosquitto/log
rm -f mosquitto/config/passwd
# Mosquitto 2.1 cảnh báo file acl cho mọi người đọc; git không lưu quyền này nên đặt lại ở đây.
chmod 600 mosquitto/config/acl

first=1
for prefix in MQTT_BACKEND MQTT_DEVICE MQTT_FAKE_DEVICE; do
  user="$(env_get "${prefix}_USER")"
  pass="$(env_get "${prefix}_PASS")"
  if [ -z "$user" ] || [ -z "$pass" ]; then
    echo "Thiếu ${prefix}_USER hoặc ${prefix}_PASS trong .env" >&2
    exit 1
  fi
  flags="-b"
  [ "$first" = 1 ] && flags="-c -b"
  first=0

  # Mật khẩu truyền qua biến môi trường để không lộ trong danh sách tiến trình của máy.
  MQ_USER="$user" MQ_PASS="$pass" \
    docker compose run --rm -T --user "$(id -u):$(id -g)" -e MQ_USER -e MQ_PASS mosquitto \
    sh -c "mosquitto_passwd $flags $PASSWD_IN_CONTAINER \"\$MQ_USER\" \"\$MQ_PASS\""
  echo "Đã tạo user: $user"
done

if [ -n "$(docker compose ps --status running --quiet mosquitto)" ]; then
  echo "Broker đang chạy, khởi động lại để nhận mật khẩu mới..."
  docker compose restart mosquitto
fi
