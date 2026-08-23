#include <Arduino.h>
#include <Preferences.h>   // gateway flag persistence (Step 5)
#include "Config.h"      // tuning constants, pins, SensorNode, nodes[]
#include "Led.h"
#include "Baseline.h"   // baselineCollecting (extern)

// LED state (internal to this module).
static LedState ledState    = LED_OFF;
static bool     isGateway  = false;

// NVS access for the gateway flag (internal).
static Preferences gwPrefs;

// True if this box is the gateway — the RS-485 module uses it to decide
// whether it's the master (polls) or a slave (answers).
bool isThisGateway() { return isGateway; }

// Persist the gateway flag to ESP32 flash so a reboot restores the role.
void saveGatewayToFlash() {
  gwPrefs.begin("gateway", false);
  gwPrefs.putBool("is_gateway", isGateway);
  gwPrefs.end();
}

// Restore the gateway flag from flash at boot. Prints the restored role so
// the operator knows this box is the master before any button is needed.
void loadGatewayFromFlash() {
  gwPrefs.begin("gateway", true);
  isGateway = gwPrefs.getBool("is_gateway", false);
  gwPrefs.end();
  Serial.print("gateway: ");
  Serial.println(isGateway ? "ON (from flash) — this box is the master"
                           : "OFF (from flash) — normal sensor node");
}

// The 4-state LED machine. No error state. When isGateway is true and
// baselines are loaded, the LED shows the heartbeat instead of plain solid.
void setGateway(bool v) {
  isGateway = v;
  saveGatewayToFlash();   // programmatic set also persists
}

// Flip the gateway flag (used by the long-press and serial 'g') and persist.
// Returns the new state and prints ON/OFF so both input methods share one
// feedback path.
bool toggleGateway() {
  isGateway = !isGateway;
  saveGatewayToFlash();
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
