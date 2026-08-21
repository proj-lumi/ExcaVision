#include <Arduino.h>
#include "SerialLogger.h"
#include "Config.h"

void logReadingToSerial(const SensorReading &reading) {
  Serial.print("AX: "); Serial.print(reading.ax);
  Serial.print("  AY: "); Serial.print(reading.ay);
  Serial.print("  AZ: "); Serial.print(reading.az);
  Serial.print("  | Pitch: "); Serial.print(reading.pitch, 2);
  Serial.print(" deg  Roll: "); Serial.print(reading.roll, 2);
  Serial.print(" deg");

  #if DEBUG_MODE
  Serial.print("  | Free heap: ");
  Serial.println(ESP.getFreeHeap());
  #else
  Serial.println();
  #endif
}

void logI2CFailure() {
  #if DEBUG_MODE
  Serial.println("I2C read failed, skipping this cycle");
  #endif
}
