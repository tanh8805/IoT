// Test relay: bật 5 giây, tắt 5 giây, lặp lại. Bơm nối qua COM/NO sẽ chạy theo.
// Relay để jumper L: bật = kéo chân xuống GND (OUTPUT LOW), tắt = thả nổi (INPUT).
const int PIN_RELAY = 14;

void relaySet(bool on) {
  if (on) { digitalWrite(PIN_RELAY, LOW); pinMode(PIN_RELAY, OUTPUT); }
  else    { pinMode(PIN_RELAY, INPUT); }
}

void setup() {
  Serial.begin(115200);
  relaySet(false);
  Serial.println("relay_test: chan 14");
}

void loop() {
  Serial.println("Relay BAT");
  relaySet(true);
  delay(5000);
  Serial.println("Relay TAT");
  relaySet(false);
  delay(5000);
}
