#!/usr/bin/env python3
"""Đo độ trễ lệnh: từ lúc gửi cmd tới lúc nhận ack đúng cmd_id.

Đăng nhập bằng user backend, gửi N lệnh "pump_off" (an toàn, không bật bơm) lần lượt
tới một thiết bị, mỗi lệnh chờ ack rồi mới gửi lệnh kế. In min/trung bình/max và số lệnh mất.

Chạy: python3 measure_cmd_latency.py [--device chau-02] [-n 20] [--timeout 5]
Với chau-02 cần chạy fake_device.py trước.
"""
import argparse
import json
import statistics
import threading
import time
import uuid

from common import connect, load_env, make_client, require


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", help="mã thiết bị (mặc định MQTT_FAKE_DEVICE_USER trong .env)")
    parser.add_argument("-n", type=int, default=20, help="số lệnh gửi (mặc định 20)")
    parser.add_argument("--timeout", type=float, default=5, help="giây chờ ack cho mỗi lệnh (mặc định 5)")
    args = parser.parse_args()

    env = load_env()
    require(env, "MQTT_HOST", "MQTT_BACKEND_USER", "MQTT_BACKEND_PASS")
    device = args.device or env.get("MQTT_FAKE_DEVICE_USER", "chau-02")
    t_cmd, t_ack = f"devices/{device}/cmd", f"devices/{device}/ack"

    client = make_client(env["MQTT_BACKEND_USER"], env["MQTT_BACKEND_PASS"])
    state = {"cmd_id": None, "t_ack": None}
    got_ack = threading.Event()

    def on_message(c, userdata, msg):
        now = time.perf_counter()
        try:
            doc = json.loads(msg.payload)
        except ValueError:
            return
        if doc.get("cmd_id") == state["cmd_id"] and state["t_ack"] is None:
            state["t_ack"] = now
            got_ack.set()

    client.on_message = on_message
    connect(client, env, on_connect=lambda c, *a: c.subscribe(t_ack, qos=1))
    time.sleep(0.5)  # chờ SUBSCRIBE xong

    print(f"Gửi {args.n} lệnh pump_off tới {device} (chờ ack tối đa {args.timeout}s mỗi lệnh)")
    latencies, lost = [], 0
    for i in range(1, args.n + 1):
        state["cmd_id"], state["t_ack"] = f"lat-{uuid.uuid4().hex[:8]}", None
        got_ack.clear()
        payload = json.dumps({"cmd_id": state["cmd_id"], "action": "pump_off"})
        t0 = time.perf_counter()
        client.publish(t_cmd, payload, qos=1)
        if got_ack.wait(args.timeout):
            ms = (state["t_ack"] - t0) * 1000
            latencies.append(ms)
            print(f"  [{i:>3}] {ms:8.1f} ms")
        else:
            lost += 1
            print(f"  [{i:>3}] mất (không có ack)")
        time.sleep(0.2)

    client.loop_stop()
    client.disconnect()

    print("\n--- Kết quả ---")
    print(f"Đã gửi: {args.n} | nhận ack: {len(latencies)} | mất: {lost}")
    if latencies:
        print(f"min {min(latencies):.1f} ms | trung bình {statistics.mean(latencies):.1f} ms | max {max(latencies):.1f} ms")
    else:
        print("Không nhận được ack nào. Thiết bị (hoặc fake_device.py) có đang chạy không?")
    raise SystemExit(0 if lost == 0 else 1)


if __name__ == "__main__":
    main()
