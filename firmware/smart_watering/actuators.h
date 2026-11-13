#pragma once
#include "config.h"

#if HAS_SERVO
#include <ESP32Servo.h>
Servo curtainServo;
#endif

bool pumpOn = false;
unsigned long pumpStartMs = 0;
unsigned long pumpLimitMs = 0;

bool curtainClosed = false;
int pendingCurtain = -1;
unsigned long servoMovedMs = 0;

// Relay để jumper ở L nên kéo chân xuống GND là bật, thả nổi là tắt.
// 3,3V của ESP32 không đủ kích relay 5V nên không dùng HIGH/LOW.
void relaySet(bool on) {
  if (on) { digitalWrite(PIN_RELAY, LOW); pinMode(PIN_RELAY, OUTPUT); }
  else    { pinMode(PIN_RELAY, INPUT); }
}

void actuatorsBegin() {
  relaySet(false);
#if HAS_SERVO
  curtainServo.attach(PIN_SERVO);
  curtainServo.write(SERVO_OPEN_DEG);
#endif
}

bool servoBusy() { return millis() - servoMovedMs < 700; }

void pumpStart(unsigned long ms) {
  while (servoBusy()) delay(10);        // bơm và servo chạy cùng lúc sẽ sụt áp
  pumpOn = true;
  pumpStartMs = millis();
  pumpLimitMs = min(ms, PUMP_MAX_MS);
  relaySet(true);
}

void pumpStop() {
  pumpOn = false;
  relaySet(false);
}

bool curtainSet(bool closed) {
#if HAS_SERVO
  if (pumpOn) {                          // chờ bơm tắt rồi mới quay servo
    pendingCurtain = closed ? 1 : 0;
    return true;
  }
  curtainServo.write(closed ? SERVO_CLOSED_DEG : SERVO_OPEN_DEG);
  curtainClosed = closed;
  servoMovedMs = millis();
  return true;
#else
  return false;
#endif
}

void actuatorsLoop() {
  if (pumpOn && millis() - pumpStartMs >= pumpLimitMs) pumpStop();
  if (!pumpOn && pendingCurtain >= 0) {
    bool c = pendingCurtain == 1;
    pendingCurtain = -1;
    curtainSet(c);
  }
}
