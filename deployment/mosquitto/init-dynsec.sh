#!/bin/sh
# Tạo file Dynamic Security ban đầu với user quản trị (MQTT_BACKEND_USER / MQTT_BACKEND_PASS).
# Chỉ chạy lần đầu; muốn tạo lại thì xóa volume: docker compose down -v
set -e
FILE=/mosquitto/data/dynamic-security.json
if [ -f "$FILE" ]; then
  echo "Đã có $FILE, bỏ qua."
  exit 0
fi
if [ -z "$MQTT_BACKEND_USER" ] || [ -z "$MQTT_BACKEND_PASS" ]; then
  echo "Thiếu MQTT_BACKEND_USER hoặc MQTT_BACKEND_PASS trong .env" >&2
  exit 1
fi
mosquitto_ctrl dynsec init "$FILE" "$MQTT_BACKEND_USER" "$MQTT_BACKEND_PASS"
chmod 600 "$FILE"
echo "Đã tạo $FILE"
