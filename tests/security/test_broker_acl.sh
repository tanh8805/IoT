#!/usr/bin/env bash
# Kiểm tra xác thực và ACL của Mosquitto. Chạy bằng docker compose exec, không cần cài
# mosquitto trên máy. Broker phải đang chạy (docker compose up -d trong deployment/).
# In PASS/FAIL cho từng bài, thoát với số bài FAIL.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] || { echo "Không thấy $ENV_FILE" >&2; exit 2; }

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r'; }
BACKEND_USER="$(env_get MQTT_BACKEND_USER)"; BACKEND_PASS="$(env_get MQTT_BACKEND_PASS)"
DEV_USER="$(env_get MQTT_DEVICE_USER)";      DEV_PASS="$(env_get MQTT_DEVICE_PASS)"
FAKE_USER="$(env_get MQTT_FAKE_DEVICE_USER)"; FAKE_PASS="$(env_get MQTT_FAKE_DEVICE_PASS)"

cd "$ROOT/deployment"
if [ -z "$(docker compose ps --status running --quiet mosquitto)" ]; then
  echo "Broker chưa chạy. Chạy: cd deployment && docker compose up -d" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

mq() { docker compose exec -T mosquitto "$@"; }
pub() { local u="$1" p="$2" t="$3" m="$4"; mq mosquitto_pub -h localhost -u "$u" -P "$p" -t "$t" -m "$m" -q 1; }
report() {
  if [ "$1" = 0 ]; then echo "PASS  $2"; else echo "FAIL  $2"; FAILS=$((FAILS + 1)); fi
}

echo "== Kiểm tra bảo mật broker =="

# 1) Không mật khẩu -> bị từ chối
out="$(mq mosquitto_pub -h localhost -t test/anon -m x -d 2>&1)"; rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -qi "not authori[sz]ed"
report $? "1. Kết nối không mật khẩu bị từ chối (exit $rc)"

# 2) Sai mật khẩu -> bị từ chối
out="$(mq mosquitto_pub -h localhost -u "$FAKE_USER" -P "sai-mat-khau" -t test/bad -m x -d 2>&1)"; rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -qi "not authori[sz]ed"
report $? "2. Kết nối sai mật khẩu bị từ chối (exit $rc)"

# 3) Thiết bị chau-02 ghi vào topic lệnh của chau-01 -> backend không nhận được.
#    Subscriber backend còn nhận được tin CONTROL gửi hợp lệ, để chắc là subscriber đang hoạt động.
mq mosquitto_sub -h localhost -u "$BACKEND_USER" -P "$BACKEND_PASS" -t "devices/$DEV_USER/cmd" -v -W 7 > "$TMP/t3.out" 2>&1 &
sub_pid=$!
sleep 2
pub "$FAKE_USER" "$FAKE_PASS" "devices/$DEV_USER/cmd" "ATTACK" >/dev/null 2>&1
sleep 1
pub "$BACKEND_USER" "$BACKEND_PASS" "devices/$DEV_USER/cmd" "CONTROL" >/dev/null 2>&1
wait $sub_pid
if grep -q "CONTROL" "$TMP/t3.out" && ! grep -q "ATTACK" "$TMP/t3.out"; then rc=0; else rc=1; fi
report $rc "3. $FAKE_USER publish vào devices/$DEV_USER/cmd, backend không nhận được"

# 4) chau-02 subscribe telemetry của chau-01 -> không nhận gì.
#    Đồng thời subscribe topic của chính nó (devices/chau-02/cmd) làm đối chứng.
mq mosquitto_sub -h localhost -u "$FAKE_USER" -P "$FAKE_PASS" \
  -t "devices/$DEV_USER/telemetry" -t "devices/$FAKE_USER/cmd" -v -W 7 > "$TMP/t4.out" 2>&1 &
sub_pid=$!
sleep 2
pub "$DEV_USER" "$DEV_PASS" "devices/$DEV_USER/telemetry" "SECRET-OF-01" >/dev/null 2>&1
pub "$BACKEND_USER" "$BACKEND_PASS" "devices/$FAKE_USER/cmd" "OWN-TOPIC" >/dev/null 2>&1
wait $sub_pid
if grep -q "OWN-TOPIC" "$TMP/t4.out" && ! grep -q "SECRET-OF-01" "$TMP/t4.out"; then rc=0; else rc=1; fi
report $rc "4. $FAKE_USER subscribe devices/$DEV_USER/telemetry, không nhận được gì"

echo "== Xong: $FAILS bài FAIL =="
exit $FAILS
