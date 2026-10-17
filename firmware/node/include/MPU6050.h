#ifndef MPU6050_H
#define MPU6050_H

#include <Arduino.h>

// TCA9548A I2C multiplexer address (A0/A1/A2 tied low → 0x70)
#define TCA9548A_ADDR 0x70

// MPU6050 I2C device address (AD0 tied LOW)
#define MPU6050_I2C_ADDR 0x68

// Register addresses (from the MPU6050 datasheet register map)
#define MPU6050_PWR_MGMT_1    0x6B   // Power Management 1 — SLEEP bit lives here
#define MPU6050_ACCEL_XOUT_H  0x3B   // Accelerometer X, high byte
#define MPU6050_ACCEL_YOUT_H  0x3D   // Accelerometer Y, high byte
#define MPU6050_ACCEL_ZOUT_H  0x3F   // Accelerometer Z, high byte
#define MPU6050_TEMP_OUT_H    0x41   // Temperature, high byte

// Channel-aware MPU6050. Each instance owns one TCA9548A channel and selects
// it before every read, so multiple sensors at the same 0x68 address coexist
// on one I2C bus via the mux. Call Wire.begin() once in setup BEFORE begin().
class MPU6050 {
public:
  void begin(uint8_t channel);   // store channel, select it, wake the chip
  bool probe();                  // ACK check — used by the boot discovery scan
  bool readAccel(int16_t &ax, int16_t &ay, int16_t &az);  // selects, then 3 reads
  float readTemperatureC();                              // selects, then 1 read
private:
  uint8_t _channel = 0;
  void select();                  // tcaSelect(_channel) — no delay
  bool read16(uint8_t reg, int16_t &out);  // big-endian 2-byte register read
};

#endif