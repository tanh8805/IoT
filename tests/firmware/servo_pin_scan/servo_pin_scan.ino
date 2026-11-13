// Tìm lỗi đường tín hiệu servo. Phát cùng một tín hiệu servo (0 độ <-> 90 độ, mỗi 2 giây)
// trên nhiều chân cùng lúc. Chỉ cần chuyển dây cam (tín hiệu) của servo lần lượt sang từng chân.
// Dây đỏ nối thẳng VIN và dây nâu nối thẳng GND của ESP32 (không qua breadboard).
#include <ESP32Servo.h>

const int PINS[] = {13, 18, 19, 21, 22, 23};
const int N = sizeof(PINS) / sizeof(PINS[0]);
Servo servos[N];

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) ESP32PWM::allocateTimer(i);
  Serial.print("servo_pin_scan: phat tin hieu tren D");
  for (int i = 0; i < N; i++) {
    int ch = servos[i].attach(PINS[i]);
    Serial.printf("%d%s ", PINS[i], ch > 0 ? "" : "(LOI attach)");
  }
  Serial.println();
}

void loop() {
  for (int i = 0; i < N; i++) servos[i].write(0);
  Serial.println("0 do");
  delay(2000);
  for (int i = 0; i < N; i++) servos[i].write(90);
  Serial.println("90 do");
  delay(2000);
}
