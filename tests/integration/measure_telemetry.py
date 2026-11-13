#!/usr/bin/env python3
"""Đo tỷ lệ mất bản tin và khoảng cách giữa các bản tin telemetry của một thiết bị.

Nghe devices/<id>/telemetry trong X phút bằng user backend. Số bản tin kỳ vọng =
thời gian nghe / chu kỳ gửi (10 giây/bản), có thể lệch ±1 do không biết pha gửi.

Chạy: python3 measure_telemetry.py [--device chau-02] [--minutes 5] [--interval 10]
"""
import argparse
import json
import statistics
import time

from common import connect, load_env, make_client, require


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", help="mã thiết bị (mặc định MQTT_FAKE_DEVICE_USER trong .env)")
    parser.add_argument("--minutes", type=float, default=5, help="thời gian nghe, phút (mặc định 5)")
    parser.add_argument("--interval", type=float, default=10, help="chu kỳ gửi của thiết bị, giây (mặc định 10)")
    args = parser.parse_args()

    env = load_env()
    require(env, "MQTT_HOST", "MQTT_BACKEND_USER", "MQTT_BACKEND_PASS")
    device = args.device or env.get("MQTT_FAKE_DEVICE_USER", "chau-02")
    topic = f"devices/{device}/telemetry"

    arrivals, seen_ts, duplicates = [], set(), 0

    def on_message(c, userdata, msg):
        nonlocal duplicates
        arrivals.append(time.monotonic())
        try:
            ts = json.loads(msg.payload).get("ts")
        except ValueError:
            return
        if ts is not None:
            if ts in seen_ts:
                duplicates += 1
            seen_ts.add(ts)

    client = make_client(env["MQTT_BACKEND_USER"], env["MQTT_BACKEND_PASS"])
    client.on_message = on_message
    connect(client, env, on_connect=lambda c, *a: c.subscribe(topic, qos=1))

    duration = args.minutes * 60
    print(f"Nghe {topic} trong {args.minutes} phút...")
    start = time.monotonic()
    while time.monotonic() - start < duration:
        time.sleep(min(30, max(0.1, duration - (time.monotonic() - start))))
        print(f"  {time.monotonic() - start:6.0f}s: đã nhận {len(arrivals)} bản tin")
    client.loop_stop()
    client.disconnect()

    expected = int(duration // args.interval)
    received = len(arrivals)
    print("\n--- Kết quả ---")
    print(f"Thời gian nghe: {duration:.0f}s | kỳ vọng: {expected} bản | nhận: {received} bản")
    if expected > 0:
        loss = max(0, expected - received) / expected * 100
        print(f"Tỷ lệ mất bản tin: {loss:.1f}% (sai số ±1 bản do lệch pha)")
    print(f"Bản tin trùng ts: {duplicates}")
    gaps = [b - a for a, b in zip(arrivals, arrivals[1:])]
    if gaps:
        late = sum(1 for g in gaps if g > 1.5 * args.interval)
        print(f"Khoảng cách giữa các bản tin: min {min(gaps):.2f}s | trung bình {statistics.mean(gaps):.2f}s | max {max(gaps):.2f}s")
        print(f"Khoảng cách > {1.5 * args.interval:.0f}s (nghi mất bản tin): {late}")
    elif received == 0:
        print("Không nhận được bản tin nào. Thiết bị có đang chạy không?")


if __name__ == "__main__":
    main()
