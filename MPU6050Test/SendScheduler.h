#ifndef SEND_SCHEDULER_H
#define SEND_SCHEDULER_H

#include "MPU6050Sensor.h"

void sendReadingIfDue(const SensorReading &reading);

#endif
