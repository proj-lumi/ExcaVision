#ifndef SUPABASE_CLIENT_H
#define SUPABASE_CLIENT_H

#include "MPU6050Sensor.h"

void sendReadingToSupabase(const SensorReading &reading);

#endif
