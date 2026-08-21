#include "Config.h"
#include "MPU6050Sensor.h"
#include "SerialLogger.h"

void setup() {
  Serial.begin(115200);
  initSensor();
}

void loop() {
  SensorReading reading = readSensorData();

  if (reading.valid) {
    logReadingToSerial(reading);
  } else {
    logI2CFailure();
  }

  delay(LOOP_DELAY_MS);
}