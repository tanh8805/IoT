#pragma once

#define DEVICE_ID   "chau-01"
#define FW_VERSION  "1.0.7"

#define HAS_LIGHT 1
#define HAS_SERVO 1

const int PIN_SOIL_POWER  = 27;
const int PIN_SOIL_AO     = 34;
const int PIN_RELAY       = 14;
const int PIN_LIGHT_POWER = 32;
const int PIN_SDA         = 25;
const int PIN_SCL         = 33;
const int PIN_SERVO       = 12;

const int SOIL_DRY_RAW = 3800;
const int SOIL_WET_RAW = 650;

const unsigned long READ_MS        = 10000;
const unsigned long PUMP_MAX_MS    = 15000;
const unsigned long AUTO_PUMP_MS   = 2000;
const unsigned long SOAK_MS        = 60000;
const int           MAX_AUTO_DOSES = 5;
const unsigned long CURTAIN_HOLD_MS = 10000;

const int   DEFAULT_SOIL_THRESHOLD = 40;
// Hai ngưỡng cách xa nhau và phải giữ CURTAIN_HOLD_MS mới đổi, để màn không đóng mở liên tục.
const float DEFAULT_LUX_CLOSE      = 10000;
const float DEFAULT_LUX_OPEN       = 5000;

const int SERVO_OPEN_DEG   = 0;
const int SERVO_CLOSED_DEG = 90;
