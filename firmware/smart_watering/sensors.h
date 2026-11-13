#pragma once
#include "config.h"

#if HAS_LIGHT
#include <Wire.h>
#include <BH1750.h>
BH1750 lightMeter;
bool lightReady = false;
#endif

void sensorsBegin() {
  pinMode(PIN_SOIL_POWER, OUTPUT);
  digitalWrite(PIN_SOIL_POWER, LOW);

#if HAS_LIGHT
  pinMode(PIN_LIGHT_POWER, OUTPUT);
  digitalWrite(PIN_LIGHT_POWER, HIGH);
  delay(100);                           // BH1750 cần thời gian lên điện, chờ 10 ms thì begin() hay thất bại
  Wire.begin(PIN_SDA, PIN_SCL);
  lightReady = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE);
#endif
}

// Cảm biến đất chỉ được cấp điện lúc đo, vì cấp liên tục thì hai chân kim loại bị ăn mòn nhanh.
int readSoilRaw() {
  digitalWrite(PIN_SOIL_POWER, HIGH);
  delay(50);
  long sum = 0;
  for (int i = 0; i < 10; i++) {
    sum += analogRead(PIN_SOIL_AO);
    delay(2);
  }
  digitalWrite(PIN_SOIL_POWER, LOW);
  return sum / 10;
}

int soilPercent(int raw) {
  return constrain(map(raw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100), 0, 100);
}

float readLux() {
#if HAS_LIGHT
  if (!lightReady) {                    // chưa cấu hình được thì thử lại, để cắm lại dây là tự hồi phục
    lightReady = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE);
    if (!lightReady) return -1;
  }
  float lux = lightMeter.readLightLevel();
  return lux < 0 ? -1 : lux;
#else
  return -1;
#endif
}
