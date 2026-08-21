#include <Wire.h>
#include <math.h>
#include "MPU6050Sensor.h"
#include "Config.h"

static bool readRegister16(byte reg, int16_t &result) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    #if DEBUG_MODE
    Serial.print("[I2C] Transmission failed for register 0x");
    Serial.println(reg, HEX);
    #endif
    return false;
  }

  Wire.requestFrom(MPU_ADDR, (byte)2);
  if (Wire.available() < 2) {
    #if DEBUG_MODE
    Serial.print("[I2C] Insufficient bytes for register 0x");
    Serial.println(reg, HEX);
    #endif
    return false;
  }

  int16_t high = Wire.read();
  int16_t low = Wire.read();
  result = (high << 8) | low;
  return true;
}

// Converts raw accel counts (at default +/-2g range, 16384 counts/g) into
// pitch/roll tilt angles in degrees, using gravity's split across axes.
static void computeTiltAngles(int16_t ax, int16_t ay, int16_t az, float &pitch, float &roll) {
  float gx = ax / 16384.0;
  float gy = ay / 16384.0;
  float gz = az / 16384.0;

  pitch = atan2(gx, sqrt(gy * gy + gz * gz)) * 180.0 / PI;
  roll  = atan2(gy, sqrt(gx * gx + gz * gz)) * 180.0 / PI;
}

void initSensor() {
  Wire.begin(SDA_PIN, SCL_PIN);
  delay(100);

  // Wake up the sensor (register 0x6B, clear sleep bit)
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission();

  Serial.println("MPU6050 initialized!");
}

SensorReading readSensorData() {
  SensorReading reading = {0, 0, 0, 0.0, 0.0, false};

  bool ok = readRegister16(0x3B, reading.ax) &&
            readRegister16(0x3D, reading.ay) &&
            readRegister16(0x3F, reading.az);

  if (ok) {
    computeTiltAngles(reading.ax, reading.ay, reading.az, reading.pitch, reading.roll);
  }

  reading.valid = ok;
  return reading;
}