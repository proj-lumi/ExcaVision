#include <Wire.h>
#include "MPU6050.h"

// Read one 16-bit big-endian register. Returns false on I2C failure so a
// failure is distinguishable from a real 0 reading.
bool MPU6050::read16(uint8_t reg, int16_t &out) {
  Wire.beginTransmission(MPU6050_I2C_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  Wire.requestFrom(MPU6050_I2C_ADDR, (uint8_t)2);
  if (Wire.available() < 2) return false;

  int16_t high = Wire.read();
  int16_t low  = Wire.read();
  out = (high << 8) | low;
  return true;
}

void MPU6050::begin(uint8_t sda, uint8_t scl) {
  Wire.begin(sda, scl);
  delay(100);  // let the chip settle

  // Wake the MPU6050: write 0x00 to PWR_MGMT_1 to clear the SLEEP bit.
  Wire.beginTransmission(MPU6050_I2C_ADDR);
  Wire.write(MPU6050_PWR_MGMT_1);
  Wire.write(0x00);
  Wire.endTransmission();
}

bool MPU6050::readAccel(int16_t &ax, int16_t &ay, int16_t &az) {
  bool ok = read16(MPU6050_ACCEL_XOUT_H, ax) &&
            read16(MPU6050_ACCEL_YOUT_H, ay) &&
            read16(MPU6050_ACCEL_ZOUT_H, az);
  return ok;
}

float MPU6050::readTemperatureC() {
  int16_t raw;
  if (!read16(MPU6050_TEMP_OUT_H, raw)) return NAN;  // bus failure
  return (raw / 340.0) + 36.53;  // datasheet conversion
}