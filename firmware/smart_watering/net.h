#pragma once
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include "config.h"
#include "secrets.h"
#include "actuators.h"
#include "automation.h"

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
Preferences prefs;

const String T_BASE      = String("devices/") + DEVICE_ID;
const String T_TELEMETRY = T_BASE + "/telemetry";
const String T_STATUS    = T_BASE + "/status";
const String T_CMD       = T_BASE + "/cmd";
const String T_ACK       = T_BASE + "/ack";
const String T_CONFIG    = T_BASE + "/config";

bool wifiAnnounced = false;
unsigned long lastMqttTry = 0;

void loadConfig() {
  prefs.begin("chau", false);
  soilThreshold = prefs.getInt("soil_thr", DEFAULT_SOIL_THRESHOLD);
  luxClose      = prefs.getFloat("lux_close", DEFAULT_LUX_CLOSE);
  luxOpen       = prefs.getFloat("lux_open", DEFAULT_LUX_OPEN);
}

void publishAck(const char* cmdId, const char* result, const char* msg) {
  JsonDocument doc;
  doc["cmd_id"] = cmdId;
  doc["result"] = result;
  doc["msg"]    = msg;
  char buf[256];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(T_ACK.c_str(), (const uint8_t*)buf, n, false);
}

// cmd_id của lệnh vừa xử lý, để bỏ qua lệnh gửi lại do QoS 1 hoặc backend retry.
String lastCmdId;

void handleCmd(JsonDocument& doc) {
  const char* id     = doc["cmd_id"] | "";
  const char* action = doc["action"] | "";

  if (id[0] != '\0') {
    if (lastCmdId == id) {
      publishAck(id, "ok", "duplicate");
      return;
    }
    lastCmdId = id;
  }

  if (strcmp(action, "pump_on") == 0) {
    int s = doc["duration_s"] | 5;
    if (s < 1 || s > (int)(PUMP_MAX_MS / 1000)) {
      publishAck(id, "error", "duration_s phai tu 1 den 15");
      return;
    }
    pumpStart(s * 1000UL);
    publishAck(id, "ok", "");
  } else if (strcmp(action, "pump_off") == 0) {
    pumpStop();
    publishAck(id, "ok", "");
  } else if (strcmp(action, "curtain_open") == 0 || strcmp(action, "curtain_close") == 0) {
    bool ok = curtainSet(strcmp(action, "curtain_close") == 0);
    publishAck(id, ok ? "ok" : "error", ok ? "" : "chua lap servo");
  } else {
    publishAck(id, "error", "action khong hop le");
  }
}

void handleConfig(JsonDocument& doc) {
  if (doc["soil_threshold"].is<int>()) soilThreshold = constrain(doc["soil_threshold"].as<int>(), 5, 95);
  if (doc["lux_close"].is<float>())    luxClose = doc["lux_close"].as<float>();
  if (doc["lux_open"].is<float>())     luxOpen  = doc["lux_open"].as<float>();
  if (luxOpen >= luxClose) luxOpen = luxClose / 2;

  prefs.putInt("soil_thr", soilThreshold);
  prefs.putFloat("lux_close", luxClose);
  prefs.putFloat("lux_open", luxOpen);

  autoDoses = 0;
  autoBlocked = false;
  Serial.printf("Config moi: soil<%d%%, lux dong>%.0f, mo<%.0f\n", soilThreshold, luxClose, luxOpen);
}

void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  if (T_CMD == topic)         handleCmd(doc);
  else if (T_CONFIG == topic) handleConfig(doc);
}

void mqttConnect() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastMqttTry < 5000) return;
  lastMqttTry = millis();

  // Last Will: ESP32 mất mạng đột ngột thì broker tự gửi "offline" thay cho nó.
  if (mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASS, T_STATUS.c_str(), 1, true, "offline")) {
    mqtt.publish(T_STATUS.c_str(), "online", true);
    mqtt.subscribe(T_CMD.c_str(), 1);
    mqtt.subscribe(T_CONFIG.c_str(), 1);
    Serial.println("MQTT da ket noi");
  } else {
    Serial.printf("MQTT loi, ma %d\n", mqtt.state());
  }
}

void publishTelemetry(int soilRaw, int soilPct, float lux) {
  JsonDocument doc;
  time_t now = time(nullptr);
  if (now > 1700000000) doc["ts"] = (uint32_t)now;
  else                  doc["ts"] = nullptr;
  doc["soil_raw"] = soilRaw;
  doc["soil_pct"] = soilPct;
  if (lux >= 0) doc["lux"] = lux;
  else          doc["lux"] = nullptr;
  doc["pump"] = pumpOn;
#if HAS_SERVO
  doc["curtain"] = curtainClosed ? "closed" : "open";
#else
  doc["curtain"] = nullptr;
#endif
  doc["auto_blocked"] = autoBlocked;
  doc["fw"] = FW_VERSION;

  char buf[256];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(T_TELEMETRY.c_str(), (const uint8_t*)buf, n, false);
}

void netBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);             // tắt tiết kiệm điện WiFi vì chế độ này hay làm rớt MQTT
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  configTime(0, 0, "pool.ntp.org");

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);            // nới thời gian giữ kết nối từ 15 lên 30 giây
  mqtt.setSocketTimeout(5);         // broker không trả lời thì bỏ sau 5 giây, không đứng chờ 15 giây
}

void netLoop() {
  if (WiFi.status() == WL_CONNECTED && !wifiAnnounced) {
    Serial.print("WiFi OK, IP: ");
    Serial.println(WiFi.localIP());
    wifiAnnounced = true;
  }
  mqttConnect();
  mqtt.loop();
}
