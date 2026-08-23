#ifndef SENDER_H
#define SENDER_H

#include <Arduino.h>

// Cloud sync runs in its OWN FreeRTOS task so the blocking WiFi/TLS/HTTP work
// never stalls the 100 Hz sampling or the RS-485 polling. The main loop only
// enqueues readings/events (microseconds, non-blocking); the task batches and
// POSTs on its own core.
//
// senderInit() is idempotent — call it when the box is/become the gateway.

void senderInit();   // create queues + start the cloud task (gateway only)

// Non-blocking (enqueue + return in microseconds; drop on overflow):
void senderAddReading(const char* mac, uint8_t channel, float tilt, float g,
                      float temp, uint32_t n, uint32_t fail, bool alertFlag);

void senderPushAlert(const char* mac, uint8_t channel, const char* kind,
                     const char* severity, float value);

void senderUploadBaseline(const char* mac, uint8_t channel,
                          float bx, float by, float bz);

bool senderTakeThresholdChange(float& value);   // main loop: consume a pending threshold change to relay to slaves

#endif