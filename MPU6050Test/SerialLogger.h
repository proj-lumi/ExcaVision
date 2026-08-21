#ifndef SERIAL_LOGGER_H
#define SERIAL_LOGGER_H

#include "MPU6050Sensor.h"

void logReadingToSerial(const SensorReading &reading);
void logI2CFailure();

#endif
