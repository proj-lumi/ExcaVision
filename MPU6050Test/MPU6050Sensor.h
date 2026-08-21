#ifndef MPU6050_SENSOR_H
#define MPU6050_SENSOR_H

#include <Arduino.h>

struct SensorReading {
  int16_t ax, ay, az;
  float pitch, roll; // degrees
  bool valid;
};

void initSensor();
SensorReading readSensorData();

#endif
