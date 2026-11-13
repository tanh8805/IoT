#pragma once
#include "config.h"
#include "actuators.h"

int   soilThreshold = DEFAULT_SOIL_THRESHOLD;
float luxClose      = DEFAULT_LUX_CLOSE;
float luxOpen       = DEFAULT_LUX_OPEN;

unsigned long lastDoseMs = 0;
int  autoDoses   = 0;
bool autoBlocked = false;

void autoWatering(int soilPct) {
  if (soilPct >= soilThreshold) {
    autoDoses = 0;
    autoBlocked = false;
    return;
  }
  if (autoBlocked || pumpOn) return;
  if (millis() - lastDoseMs < AUTO_PUMP_MS + SOAK_MS) return;

  // Giới hạn số đợt tưới: tưới mãi mà đất vẫn khô thì có thể bể cạn hoặc cảm biến tuột, dừng để khỏi bơm không.
  if (autoDoses >= MAX_AUTO_DOSES) {
    autoBlocked = true;
    return;
  }
  pumpStart(AUTO_PUMP_MS);
  lastDoseMs = millis();
  autoDoses++;
}

// Dùng hai ngưỡng lux cách xa nhau và bắt giữ CURTAIN_HOLD_MS mới đổi,
// để màn không đóng mở liên tục mỗi khi có mây bay qua.
unsigned long luxChangeSince = 0;

void autoCurtain(float lux) {
  if (lux < 0) return;
  bool wantClosed = curtainClosed ? (lux > luxOpen) : (lux > luxClose);
  if (wantClosed == curtainClosed) {
    luxChangeSince = 0;
    return;
  }
  if (luxChangeSince == 0) luxChangeSince = millis();
  if (millis() - luxChangeSince >= CURTAIN_HOLD_MS) {
    curtainSet(wantClosed);
    luxChangeSince = 0;
  }
}
