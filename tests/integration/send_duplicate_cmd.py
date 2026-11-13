#!/usr/bin/env python3
"""Kiểm tra chặn lệnh trùng: gửi cùng một cmd_id hai lần, lần hai phải trả ack "duplicate".

Dùng lệnh "pump_off" (an toàn). Lần một phải ack "ok" không phải "duplicate".
Thoát 0 nếu PASS, 1 nếu FAIL.

Chạy: python3 send_duplicate_cmd.py [--device chau-02] [--timeout 5]
"""
import argparse
import json
import queue
import time
import uuid

from common import connect, load_env, make_client, require


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", help="mã thiết bị (mặc định MQTT_FAKE_DEVICE_USER trong .env)")
    parser.add_argument("--timeout", type=float, default=5, help="giây chờ mỗi ack (mặc định 5)")
    args = parser.parse_args()

    env = load_env()
    require(env, "MQTT_HOST", "MQTT_BACKEND_USER", "MQTT_BACKEND_PASS")
    device = args.device or env.get("MQTT_FAKE_DEVICE_USER", "chau-02")
    t_cmd, t_ack = f"devices/{device}/cmd", f"devices/{device}/ack"
    cmd_id = f"dup-{uuid.uuid4().hex[:8]}"
    acks = queue.Queue()

    def on_message(c, userdata, msg):
        try:
            doc = json.loads(msg.payload)
        except ValueError:
            return
        if doc.get("cmd_id") == cmd_id:
            acks.put(doc)

    client = make_client(env["MQTT_BACKEND_USER"], env["MQTT_BACKEND_PASS"])
    client.on_message = on_message
    connect(client, env, on_connect=lambda c, *a: c.subscribe(t_ack, qos=1))
    time.sleep(0.5)

    payload = json.dumps({"cmd_id": cmd_id, "action": "pump_off"})
    results = []
    for n in (1, 2):
        client.publish(t_cmd, payload, qos=1)
        try:
            ack = acks.get(timeout=args.timeout)
        except queue.Empty:
            ack = None
        print(f"Lần {n}: gửi cmd_id={cmd_id} -> ack {ack}")
        results.append(ack)
    client.loop_stop()
    client.disconnect()

    first, second = results
    ok_first = bool(first) and first.get("result") == "ok" and first.get("msg") != "duplicate"
    ok_second = bool(second) and second.get("result") == "ok" and second.get("msg") == "duplicate"
    print(f"Lần 1 thực hiện bình thường: {'PASS' if ok_first else 'FAIL'}")
    print(f"Lần 2 trả \"duplicate\":       {'PASS' if ok_second else 'FAIL'}")
    raise SystemExit(0 if ok_first and ok_second else 1)


if __name__ == "__main__":
    main()
