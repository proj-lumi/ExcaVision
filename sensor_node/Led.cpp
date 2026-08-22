#include <Arduino.h>
#include "Config.h"      // tuning constants, pins, SensorNode, nodes[]
#include "Led.h"
#include "Baseline.h"   // baselineCollecting (extern)

// LED state (internal to this module).
static LedState ledState    = LED_OFF;
static bool     isGateway  = false;

// The 4-state LED machine. No error state. When isGateway is true and
// baselines are loaded, the LED shows the heartbeat instead of plain solid.
void setGateway(bool v) { isGateway = v; }

// Flip the gateway flag (used by the long-press and serial 'g'). Returns the
// new state and prints ON/OFF so both input methods share one feedback path.
bool toggleGateway() {
  isGateway = !isGateway;
  if (isGateway) Serial.println("gateway mode ON — this box is now the master");
  else           Serial.println("gateway mode OFF — this box is a normal sensor node");
  return isGateway;
}

// Derive the LED state from the node states. Called every loop() so it stays
// in sync with baseline/zero changes.
void recomputeLedState() {
  uint8_t presentCount  = 0;
  bool    allHaveBase   = true;
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (!nodes[i].present) continue;
    presentCount++;
    if (!nodes[i].hasBaseline) allHaveBase = false;
  }

  if (baselineCollecting) {
    ledState = LED_FAST_BLINK;      // busy capturing a baseline
  } else if (presentCount == 0 || !allHaveBase) {
    ledState = LED_OFF;             // no sensors, or some still need a baseline
  } else {
    ledState = isGateway ? LED_HEARTBEAT : LED_SOLID;
  }
}

// Non-blocking LED driver, called every loop(). Each state is just "is the
// LED on at this millisecond?" — pure time math, no stored toggle state.
void updateLed() {
  unsigned long now = millis();
  bool on = false;
  switch (ledState) {
    case LED_OFF:        on = false;                          break;
    case LED_SOLID:      on = true;                           break;
    case LED_FAST_BLINK: on = (now % 200)  < 100;             break; // ~5 Hz
    case LED_HEARTBEAT:  on = (now % 2000) < 1900;            break; // solid w/ dip
  }
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}
