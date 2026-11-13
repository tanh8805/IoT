// Tìm dây BH1750 bị hỏng hoặc lỏng. Mỗi vòng (~1 giây) in một dòng kết luận.
// Lắc nhẹ từng dây một: dây nào làm kết luận đổi thì dây đó lỏng.
//
// Cách đọc: module GY-302 có điện trở kéo lên (pull-up) nối vào VCC trên đường SDA và SCL.
// Ta đọc mỗi chân bằng INPUT_PULLDOWN: đọc được 1 nghĩa là chân đó đang nối được tới
// pull-up của module, tức là có điện (VCC từ D32) và dây của chính chân đó còn tốt.
#include <Wire.h>

const int PIN_LIGHT_POWER = 32;
const int PIN_SDA = 25;
const int PIN_SCL = 33;
const uint8_t BH1750_ADDR = 0x23;

const int LEVEL_SAMPLES = 100;
const int PROBES = 20;

// Trả về số lần đọc được mức 1 trên LEVEL_SAMPLES lần.
int sampleHigh(int pin) {
  pinMode(pin, INPUT_PULLDOWN);
  delay(2);
  int high = 0;
  for (int i = 0; i < LEVEL_SAMPLES; i++) {
    if (digitalRead(pin)) high++;
    delayMicroseconds(200);
  }
  return high;
}

// 0 = thấp hẳn, 1 = cao hẳn, 2 = nhảy qua lại (chập chờn).
int classify(int high) {
  if (high <= LEVEL_SAMPLES * 5 / 100) return 0;
  if (high >= LEVEL_SAMPLES * 95 / 100) return 1;
  return 2;
}

const char* levelName(int c) { return c == 0 ? "THAP" : c == 1 ? "CAO" : "CHAP CHON"; }

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(PIN_LIGHT_POWER, OUTPUT);
  digitalWrite(PIN_LIGHT_POWER, HIGH);
  delay(200);
  Serial.println();
  Serial.println("bh1750_wire_test: VCC=D32, SDA=D25, SCL=D33");
  Serial.println("Muc CAO = chan do duoc pull-up cua module (day tot). Lac tung day va xem ket luan doi.");
}

void loop() {
  Wire.end();
  int sdaHigh = sampleHigh(PIN_SDA);
  int sclHigh = sampleHigh(PIN_SCL);
  int sda = classify(sdaHigh);
  int scl = classify(sclHigh);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);
  int ok = 0, nack = 0, other = 0, timeout = 0;
  for (int i = 0; i < PROBES; i++) {
    Wire.beginTransmission(BH1750_ADDR);
    uint8_t e = Wire.endTransmission();
    if (e == 0) ok++;
    else if (e == 2 || e == 3) nack++;
    else if (e == 5) timeout++;
    else other++;
    delay(5);
  }

  const char* verdict;
  if (sda == 0 && scl == 0)        verdict = "SDA va SCL deu THAP: nghi day VCC (D32) hoac module khong co dien";
  else if (sda == 0)               verdict = "SDA (D25) THAP: day SDA khong noi duoc";
  else if (scl == 0)               verdict = "SCL (D33) THAP: day SCL khong noi duoc";
  else if (sda == 2 && scl == 2)   verdict = "SDA va SCL cung CHAP CHON: nghi day VCC (D32) long";
  else if (sda == 2)               verdict = "SDA (D25) CHAP CHON: day SDA long";
  else if (scl == 2)               verdict = "SCL (D33) CHAP CHON: day SCL long";
  else if (ok == PROBES)           verdict = "TOT: BH1750 tra loi o moi lan thu";
  else if (ok > 0)                 verdict = "0x23 luc thay luc khong: nghi day GND hoac VCC long (SDA/SCL van tot)";
  else                             verdict = "SDA/SCL deu co dien nhung khong thay 0x23: nghi day GND, hoac module hong";

  Serial.printf("SDA(D25) %3d/%d %-9s | SCL(D33) %3d/%d %-9s | 0x23: ok %2d/%d (nack %d, loi khac %d, timeout %d)\n",
                sdaHigh, LEVEL_SAMPLES, levelName(sda),
                sclHigh, LEVEL_SAMPLES, levelName(scl),
                ok, PROBES, nack, other, timeout);
  Serial.printf("  => %s\n", verdict);
  delay(500);
}
