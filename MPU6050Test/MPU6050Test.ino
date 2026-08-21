#include "Config.h"
#include "MPU6050Sensor.h"
#include "WiFiManager.h"
#include "SupabaseClient.h"
#include "SerialLogger.h"
#include "SendScheduler.h"

void setup() {
  Serial.begin(115200);
  initSensor();
  connectToWiFi();
}

void loop() {
  SensorReading reading = readSensorData();

  if (reading.valid) {
    logReadingToSerial(reading);
    sendReadingIfDue(reading);
  } else {
    logI2CFailure();
  }

  delay(LOOP_DELAY_MS);
}
