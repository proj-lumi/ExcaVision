#include <Wire.h>
#include "MPU6050.h"

// Select a channel on the TCA9548A. Writing 1<<channel to the mux address
// connects only that channel's SDA/SCL through. NO delay: the TCA switches
// essentially immediately, and a delay here would be fatal at 100 Hz × N sensors.
static void tcaSelect(uint8_t channel) {
  if (channel > 7) return;
  Wire.beginTransmission(TCA9548A_ADDR);
  Wire.write(1 << channel);
  Wire.endTransmission();
}

void MPU6050::select() {
  tcaSelect(_channel);
}

bool MPU6050::probe() {
  // Chip-agnostic presence check: an ACK at the MPU address means a sensor is
  // on this channel (works with the 0x70 WHO_AM_I clones — no ID gate).
  select();
  Wire.beginTransmission(MPU6050_I2C_ADDR);
  return Wire.endTransmission() == 0;  // 0 = ACK received = present
}

void MPU6050::begin(uint8_t channel) {
  _channel = channel;
  select();
  delay(100);  // let the chip settle (boot-time only — never in the sample loop)

  // Wake the MPU6050: write 0x00 to PWR_MGMT_1 to clear the SLEEP bit.
  Wire.beginTransmission(MPU6050_I2C_ADDR);
  Wire.write(MPU6050_PWR_MGMT_1);
  Wire.write(0x00);
  Wire.endTransmission();
}

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

bool MPU6050::readAccel(int16_t &ax, int16_t &ay, int16_t &az) {
  // Select once per call — the TCA stays on this channel until the next call,
  // so all three reads land on the right sensor.
  select();
  bool ok = read16(MPU6050_ACCEL_XOUT_H, ax) &&
            read16(MPU6050_ACCEL_YOUT_H, ay) &&
            read16(MPU6050_ACCEL_ZOUT_H, az);
  return ok;
}

float MPU6050::readTemperatureC() {
  select();
  int16_t raw;
  if (!read16(MPU6050_TEMP_OUT_H, raw)) return NAN;  // bus failure
  return (raw / 340.0) + 36.53;  // datasheet conversion
}