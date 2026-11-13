"""Hàm dùng chung cho các script trong tests/integration."""
import os
import sys
import uuid
from pathlib import Path

import paho.mqtt.client as mqtt

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_env():
    """Đọc .env ở gốc repo, biến môi trường cùng tên được ưu tiên."""
    env = {}
    path = REPO_ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    for key in list(env):
        env[key] = os.environ.get(key, env[key])
    return env


def require(env, *keys):
    missing = [k for k in keys if not env.get(k)]
    if missing:
        sys.exit(f"Thiếu trong .env: {', '.join(missing)} (xem .env.example)")


def make_client(user, password, will=None):
    """Tạo client paho-mqtt 2.x. will = (topic, payload, qos, retain)."""
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"{user}-test-{uuid.uuid4().hex[:6]}",
    )
    client.username_pw_set(user, password)
    if will:
        topic, payload, qos, retain = will
        client.will_set(topic, payload, qos=qos, retain=retain)
    return client


def connect(client, env, wait=5.0, on_connect=None):
    """Kết nối và chờ tới khi broker chấp nhận, thoát chương trình nếu bị từ chối.

    on_connect (nếu có) được gọi sau mỗi lần nối, kể cả khi tự nối lại.
    """
    import threading

    user_callback = on_connect
    result = {}
    done = threading.Event()

    def on_connect(c, userdata, flags, reason_code, properties):
        result["rc"] = reason_code
        done.set()
        if user_callback:
            user_callback(c, userdata, flags, reason_code, properties)

    client.on_connect = on_connect
    client.connect_async(env["MQTT_HOST"], int(env.get("MQTT_PORT", 1883)), keepalive=30)
    client.loop_start()
    if not done.wait(wait):
        sys.exit(f"Không kết nối được tới {env['MQTT_HOST']}:{env.get('MQTT_PORT', 1883)}")
    if result["rc"].is_failure:
        sys.exit(f"Broker từ chối kết nối: {result['rc']}")
    return client
