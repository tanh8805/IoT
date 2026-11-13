#pragma once
#include "config.h"

#if HAS_LIGHT
#include <Wire.h>
#include <BH1750.h>
BH1750 lightMeter;
#endif

void sensorsBegin() {
  pinMode(PIN_SOIL_POWER, OUTPUT);
  digitalWrite(PIN_SOIL_POWER, LOW);

#if HAS_LIGHT
  pinMode(PIN_LIGHT_POWER, OUTPUT);
  digitalWrite(PIN_LIGHT_POWER, HIGH);
  delay(10);
  Wire.begin(PIN_SDA, PIN_SCL);
  lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE);
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
  float lux = lightMeter.readLightLevel();
  return lux < 0 ? -1 : lux;
#else
  return -1;
#endif
}
