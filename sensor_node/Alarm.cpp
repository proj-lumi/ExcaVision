#include <Arduino.h>
#include <Preferences.h>   // threshold persistence (Step 8)
#include "Config.h"      // BUZZER_PIN, THRESHOLD_DEG, beep/gap, SENSORS[], nodes[]
#include "Alarm.h"

// Alarm state (internal to this module).
static float   thresholdDeg = THRESHOLD_DEG;
static bool    alarmActive  = false;
static int8_t  trippedIndex = -1;   // -1 = none
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
// Edge-triggered prints: "ALERT Sx ..." when it trips, "ALERT cleared" when it
// drops back — so the log shows transitions, not a per-second spam.
void evaluateAlarms() {
  int8_t newTripped = -1;
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (!nodes[i].present || !nodes[i].hasBaseline) continue;
    if (nodes[i].lastTilt > thresholdDeg) { newTripped = (int8_t)i; break; }
  }

  bool wasActive = alarmActive;
  alarmActive   = (newTripped >= 0);
  trippedIndex  = newTripped;

  if (alarmActive && !wasActive) {
    tripPending = true;
    tripChannel = (uint8_t)trippedIndex;
    tripValue   = nodes[trippedIndex].lastTilt;
    Serial.print("ALERT "); Serial.print(SENSORS[trippedIndex].name);
    Serial.print(" tilt="); Serial.print(nodes[trippedIndex].lastTilt, 3);
    Serial.print("° > threshold "); Serial.print(thresholdDeg, 2); Serial.println("°");
  } else if (!alarmActive && wasActive) {
    Serial.println("ALERT cleared — back under threshold");
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