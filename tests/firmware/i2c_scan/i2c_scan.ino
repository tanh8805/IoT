// Quét I2C để tìm BH1750 (địa chỉ 0x23). Chạy cả hai chiều SDA/SCL phòng khi cắm ngược dây.
#include <Wire.h>

const int PIN_LIGHT_POWER = 32;
const int PIN_SDA = 25;
const int PIN_SCL = 33;

int scan(int sda, int scl) {
  Wire.begin(sda, scl);
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  tim thay thiet bi tai 0x%02X%s\n", addr, addr == 0x23 ? " (BH1750)" : "");
      found++;
    }
  }
  Wire.end();
  if (found == 0) Serial.println("  khong thay thiet bi nao");
  return found;
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(PIN_LIGHT_POWER, OUTPUT);
  digitalWrite(PIN_LIGHT_POWER, HIGH);
  delay(100);

  // 1 = module có điện trở kéo lên (pull-up) trên đường đó, tức là đã có điện và nối đúng chân.
  pinMode(PIN_SDA, INPUT);
  pinMode(PIN_SCL, INPUT);
  Serial.printf("Muc D%d (SDA): %d | D%d (SCL): %d\n",
                PIN_SDA, digitalRead(PIN_SDA), PIN_SCL, digitalRead(PIN_SCL));
}

void loop() {
  Serial.printf("Quet voi SDA=%d, SCL=%d:\n", PIN_SDA, PIN_SCL);
  scan(PIN_SDA, PIN_SCL);
  Serial.printf("Quet dao nguoc SDA=%d, SCL=%d:\n", PIN_SCL, PIN_SDA);
  scan(PIN_SCL, PIN_SDA);
  Serial.println();
  delay(5000);
}
