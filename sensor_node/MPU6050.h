#ifndef MPU6050_H
#define MPU6050_H

#include <Arduino.h>

// MPU6050 I2C device address (AD0 tied LOW)
#define MPU6050_I2C_ADDR     0x68

// Register addresses (from the MPU6050 datasheet register map)
#define MPU6050_PWR_MGMT_1    0x6B   // Power Management 1 — SLEEP bit lives here
#define MPU6050_ACCEL_XOUT_H  0x3B   // Accelerometer X, high byte
#define MPU6050_ACCEL_YOUT_H  0x3D   // Accelerometer Y, high byte
#define MPU6050_ACCEL_ZOUT_H  0x3F   // Accelerometer Z, high byte
#define MPU6050_TEMP_OUT_H    0x41   // Temperature, high byte

class MPU6050 {
public:
  void begin(uint8_t sda, uint8_t scl);                     // init Wire + wake the chip
  bool readAccel(int16_t &ax, int16_t &ay, int16_t &az);   // three labeled reads
  float readTemperatureC();                                // die temperature in °C
private:
  bool read16(uint8_t reg, int16_t &out);                  // big-endian 2-byte register read
};

#endif