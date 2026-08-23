#ifndef SENDER_H
#define SENDER_H

#include <Arduino.h>

// The master's outbound sync to Supabase (Phase B). Owns a bounded buffer of
// pending readings (own + all slaves'), flushes it every SENDER_BATCH_MS, and
// handles the non-batch events: threshold poll, alert push, baseline upload.
//
// NOTE: these run in loop() and BLOCK briefly during each HTTPS call. That's a
// known minor tradeoff (a poll can occasionally time out and n can dip) —
// acceptable for the bench. A non-blocking background-task version is a later
// option if it ever matters in deployment.

void senderInit();   // call once at boot (gateway only): fetch the threshold
void senderTick();   // call every loop(): flush + threshold re-poll

void senderAddReading(const char* mac, uint8_t channel,
                      float tilt, float g, float temp,
                      uint32_t n, uint32_t fail, bool alertFlag);

void senderPushAlert(const char* mac, uint8_t channel,
                     const char* kind, const char* severity, float value);

void senderUploadBaseline(const char* mac, uint8_t channel,
                          float bx, float by, float bz);

#endif
