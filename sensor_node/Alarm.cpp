#include <Arduino.h>
#include <Preferences.h>   // threshold persistence (Step 8)
#include "Config.h"      // BUZZER_PIN, THRESHOLD_DEG, beep/gap, SENSORS[], nodes[]
#include "Alarm.h"

// Alarm state (internal to this module).
static float   thresholdDeg = THRESHOLD_DEG;
static bool    alarmActive  = false;
static int8_t  trippedIndex = -1;   // -1 = none
static uint8_t aboveCount   = 0;    // consecutive report cycles a sensor stayed above threshold (debounce)
static bool    tripPending  = false; // one-shot trip notification
static uint8_t tripChannel  = 0;
static float   tripValue    = 0;

// NVS access for the threshold (internal).
static Preferences alarmPrefs;

// Persist the threshold to flash so the engineer's setting survives a reboot
// (matches the spec: each node caches the pipe's threshold in NVS).
void saveThresholdToFlash() {
  alarmPrefs.begin("alarm", false);
  alarmPrefs.putFloat("threshold", thresholdDeg);
  alarmPrefs.end();
}

// Restore the threshold from flash at boot; falls back to THRESHOLD_DEG on
// first-ever boot (nothing stored yet).
void loadThresholdFromFlash() {
  alarmPrefs.begin("alarm", true);
  thresholdDeg = alarmPrefs.getFloat("threshold", THRESHOLD_DEG);
  alarmPrefs.end();
  Serial.print("threshold: ");
  Serial.print(thresholdDeg, 2);
  Serial.println("° (from flash)");
}

bool isAlarmActive() { return alarmActive; }
const char* trippedName() { return (trippedIndex >= 0) ? SENSORS[trippedIndex].name : ""; }

// One-shot: returns true once per trip (false->active transition), then clears.
// Lets the caller route the alert (master -> Supabase, slave -> RS-485 relay).
bool alertTripPending(uint8_t& channel, float& value) {
  if (!tripPending) return false;
  tripPending = false;
  channel = tripChannel;
  value   = tripValue;
  return true;
}

void setThresholdDeg(float v) {
  thresholdDeg = v;
  saveThresholdToFlash();   // persist so a reboot keeps the setting
  Serial.print("threshold = ");
  Serial.print(thresholdDeg, 2);
  Serial.println("°");
}
float getThresholdDeg() { return thresholdDeg; }

// Check every present, baselined sensor's latest tilt against the threshold.
// Two guards stop it chattering on a sensor hovering at the line:
//   1. HOLD: the tilt must stay ABOVE threshold for ALARM_HOLD_SECONDS before
//      tripping (debounces a single-sample spike, e.g. a jostle).
//   2. HYSTERESIS: once tripped, it only CLEARS when the tripped sensor drops
//      to threshold - ALARM_HYSTERESIS_DEG — so it doesn't flap off/on the
//      instant it wobbles across the boundary.
void evaluateAlarms() {
  bool wasActive = alarmActive;

  if (alarmActive) {
    // Already alarming: hold while the tripped sensor stays above the release
    // threshold (threshold - hysteresis). Release only when it falls below.
    bool held = (trippedIndex >= 0) &&
                (nodes[trippedIndex].lastTilt >
                 thresholdDeg - ALARM_HYSTERESIS_DEG);
    if (!held) {
      alarmActive   = false;
      trippedIndex  = -1;
      Serial.println("ALERT cleared — back under threshold");
    }
    // Active stays active while held — no per-second spam.
  } else {
    // Idle: find any sensor above threshold and require it to STAY there for
    // ALARM_HOLD_SECONDS (one report cycle per second) before tripping.
    int8_t crossing = -1;
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      if (!nodes[i].present || !nodes[i].hasBaseline) continue;
      if (nodes[i].lastTilt > thresholdDeg) { crossing = (int8_t)i; break; }
    }

    if (crossing >= 0) {
      aboveCount++;
      if (aboveCount >= ALARM_HOLD_SECONDS) {
        alarmActive   = true;
        trippedIndex  = crossing;
        aboveCount    = 0;
        tripPending   = true;
        tripChannel   = SENSORS[crossing].channel;   // real TCA channel, NOT the array index
        tripValue     = nodes[crossing].lastTilt;
        Serial.print("ALERT "); Serial.print(SENSORS[crossing].name);
        Serial.print(" tilt="); Serial.print(nodes[crossing].lastTilt, 3);
        Serial.print("° > threshold "); Serial.print(thresholdDeg, 2);
        Serial.print("° (held "); Serial.print(ALARM_HOLD_SECONDS);
        Serial.println(" s)");
      } else {
        Serial.print(SENSORS[crossing].name);
        Serial.print(" above threshold "); Serial.print(aboveCount);
        Serial.print("/"); Serial.print(ALARM_HOLD_SECONDS);
        Serial.println(" s hold...");
      }
    } else {
      aboveCount = 0;   // nothing above: reset the debounce counter
    }
  }
}

// Drive the buzzer, non-blocking. While the alarm is active: beep, gap,
// beep... (time math, no stored toggle state). Off otherwise.
void updateAlarm() {
  bool on = false;
  if (alarmActive) {
    unsigned long t = millis();
    on = (t % (ALARM_BEEP_MS + ALARM_GAP_MS)) < ALARM_BEEP_MS;
  }
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
}