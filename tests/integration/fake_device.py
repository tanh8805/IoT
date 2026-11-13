#!/usr/bin/env python3
"""Thiết bị giả (mặc định chau-02) để làm backend khi không có mạch.

Gửi telemetry đúng định dạng firmware (publishTelemetry trong net.h) mỗi 10 giây,
nhận cmd/config và trả ack giống handleCmd/handleConfig, có Last Will "offline".
Dừng bằng Ctrl+C sẽ gửi "offline" trước khi thoát; muốn thử Last Will thật thì kill -9.

Chạy: python3 fake_device.py [--interval 10]
"""
import argparse
import json
import random
import signal
import threading
import time

from common import connect, load_env, make_client, require

FW_VERSION = "1.0.0-fake"
PUMP_MAX_S = 15
SOIL_DRY_RAW, SOIL_WET_RAW = 3800, 650


def soil_pct(raw):
    pct = round((raw - SOIL_DRY_RAW) * 100 / (SOIL_WET_RAW - SOIL_DRY_RAW))
    return max(0, min(100, pct))


class FakeDevice:
    def __init__(self, device_id, client, interval):
        self.id = device_id
        self.client = client
        self.interval = interval
        self.soil_raw = 2400.0
        self.pump_until = 0.0
        self.curtain = "open"
        self.last_cmd_id = ""
        self.config = {"soil_threshold": 40, "lux_close": 20000.0, "lux_open": 10000.0}
        self.stop = threading.Event()
        base = f"devices/{device_id}"
        self.t_telemetry = f"{base}/telemetry"
        self.t_status = f"{base}/status"
        self.t_cmd = f"{base}/cmd"
        self.t_ack = f"{base}/ack"
        self.t_config = f"{base}/config"

    @property
    def pump_on(self):
        return time.time() < self.pump_until

    def ack(self, cmd_id, result, msg=""):
        payload = json.dumps({"cmd_id": cmd_id, "result": result, "msg": msg})
        self.client.publish(self.t_ack, payload, qos=0)
        print(f"  ack  -> {payload}")

    def handle_cmd(self, doc):
        cmd_id = doc.get("cmd_id") or ""
        action = doc.get("action") or ""
        if cmd_id:
            if cmd_id == self.last_cmd_id:
                return self.ack(cmd_id, "ok", "duplicate")
            self.last_cmd_id = cmd_id

        if action == "pump_on":
            s = doc.get("duration_s", 5)
            if not isinstance(s, int) or s < 1 or s > PUMP_MAX_S:
                return self.ack(cmd_id, "error", "duration_s phai tu 1 den 15")
            self.pump_until = time.time() + s
            self.ack(cmd_id, "ok")
        elif action == "pump_off":
            self.pump_until = 0.0
            self.ack(cmd_id, "ok")
        elif action in ("curtain_open", "curtain_close"):
            self.curtain = "closed" if action == "curtain_close" else "open"
            self.ack(cmd_id, "ok")
        else:
            self.ack(cmd_id, "error", "action khong hop le")

    def handle_config(self, doc):
        if isinstance(doc.get("soil_threshold"), int):
            self.config["soil_threshold"] = max(5, min(95, doc["soil_threshold"]))
        for key in ("lux_close", "lux_open"):
            if isinstance(doc.get(key), (int, float)):
                self.config[key] = float(doc[key])
        if self.config["lux_open"] >= self.config["lux_close"]:
            self.config["lux_open"] = self.config["lux_close"] / 2
        print(f"  config moi: {self.config}")

    def on_message(self, client, userdata, msg):
        try:
            doc = json.loads(msg.payload)
        except ValueError:
            return
        print(f"<- {msg.topic} {msg.payload.decode(errors='replace')}")
        if msg.topic == self.t_cmd:
            self.handle_cmd(doc)
        elif msg.topic == self.t_config:
            self.handle_config(doc)

    def on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            return
        client.publish(self.t_status, "online", qos=1, retain=True)
        client.subscribe([(self.t_cmd, 1), (self.t_config, 1)])
        print(f"{self.id}: đã kết nối, status=online")

    def telemetry(self):
        if self.pump_on:
            self.soil_raw -= random.uniform(150, 250)
        else:
            self.soil_raw += random.uniform(0, 15)
        self.soil_raw = max(SOIL_WET_RAW, min(SOIL_DRY_RAW, self.soil_raw))
        raw = int(self.soil_raw)
        return {
            "ts": int(time.time()),
            "soil_raw": raw,
            "soil_pct": soil_pct(raw),
            "lux": round(random.uniform(8000, 25000), 1),
            "pump": self.pump_on,
            "curtain": self.curtain,
            "auto_blocked": False,
            "fw": FW_VERSION,
        }

    def run(self):
        while not self.stop.is_set():
            payload = json.dumps(self.telemetry())
            self.client.publish(self.t_telemetry, payload, qos=0)
            print(f"-> telemetry {payload}")
            self.stop.wait(self.interval)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--interval", type=float, default=10, help="giây giữa hai bản tin (mặc định 10)")
    args = parser.parse_args()

    env = load_env()
    require(env, "MQTT_HOST", "MQTT_FAKE_DEVICE_USER", "MQTT_FAKE_DEVICE_PASS")
    device_id = env["MQTT_FAKE_DEVICE_USER"]

    client = make_client(
        device_id,
        env["MQTT_FAKE_DEVICE_PASS"],
        will=(f"devices/{device_id}/status", "offline", 1, True),
    )
    device = FakeDevice(device_id, client, args.interval)
    client.on_message = device.on_message
    connect(client, env, on_connect=device.on_connect)

    def shutdown(signum, frame):
        device.stop.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    device.run()
    client.publish(device.t_status, "offline", qos=1, retain=True).wait_for_publish(2)
    client.loop_stop()
    client.disconnect()
    print("Đã dừng, status=offline")


if __name__ == "__main__":
    main()
