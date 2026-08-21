#include <Arduino.h>
#include "SendScheduler.h"
#include "SupabaseClient.h"
#include "Config.h"

static unsigned long lastSendTime = 0;

void sendReadingIfDue(const SensorReading &reading) {
  if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = millis();
    sendReadingToSupabase(reading);
  }
}
