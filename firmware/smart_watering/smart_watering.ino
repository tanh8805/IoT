// Hệ thống tưới cây thông minh - firmware ESP32 (nhóm 20, IoT và Ứng dụng)
#include "config.h"
#include "secrets.h"
#include "sensors.h"
#include "actuators.h"
#include "automation.h"
#include "net.h"

unsigned long lastReadMs = 0;

void setup() {
  Serial.begin(115200);
  actuatorsBegin();
  sensorsBegin();
  loadConfig();
  netBegin();
  Serial.println("Khoi dong " DEVICE_ID " fw " FW_VERSION);
}

void loop() {
  netLoop();
  actuatorsLoop();

  if (millis() - lastReadMs >= READ_MS) {
    lastReadMs = millis();

    int   soilRaw = readSoilRaw();
    int   soilPct = soilPercent(soilRaw);
    float lux     = readLux();

    autoWatering(soilPct);
    autoCurtain(lux);
    publishTelemetry(soilRaw, soilPct, lux);

    Serial.printf("dat: %d (%d%%) | lux: %.0f | bom: %s | auto_blocked: %d\n",
                  soilRaw, soilPct, lux, pumpOn ? "BAT" : "tat", autoBlocked);
  }
}
