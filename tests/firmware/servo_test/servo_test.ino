// Test servo: 0 độ -> 90 độ -> 0 độ, mỗi bước cách nhau 2 giây. Cần thư viện ESP32Servo.
#include <ESP32Servo.h>

const int PIN_SERVO = 13;
Servo servo;

void setup() {
  Serial.begin(115200);
  servo.attach(PIN_SERVO);
  Serial.println("servo_test: chan 13");
}

void loop() {
  Serial.println("0 do");
  servo.write(0);
  delay(2000);
  Serial.println("90 do");
  servo.write(90);
  delay(2000);
}
