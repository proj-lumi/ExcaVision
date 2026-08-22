#ifndef ALARM_H
#define ALARM_H

// The threshold alarm (per spec §10): every report cycle, each of the node's
// OWN sensors is checked against the engineer-set threshold degrees. If any
// crosses it, this node fires its own buzzer (one per node, loudest coverage)
// and prints an ALERT. Single-sensor-crossing trips it; multi-sensor agreement
// refinement is a later team decision.
//
// The buzzer is driven non-blocking (called every loop()). The ALERT print is
// edge-triggered (only when the alarm state changes), so it doesn't spam every
// second while tripped.

void evaluateAlarms();   // call once per report cycle: check tilt vs threshold
void updateAlarm();      // call every loop(): drive the buzzer, non-blocking
bool isAlarmActive();
const char* trippedName();   // label of the tripped sensor, or ""
void setThresholdDeg(float);
float getThresholdDeg();
void loadThresholdFromFlash();   // restore the threshold at boot (Step 8)

#endif