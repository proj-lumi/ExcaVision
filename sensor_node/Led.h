#ifndef LED_H
#define LED_H

// The 4-state LED machine. No error state (scrapped: runtime sensor
// health is the app's job; install diagnostics are the boot scan's serial
// MISSING prints).

enum LedState {
  LED_OFF,          // no baseline loaded — press the button
  LED_FAST_BLINK,   // baseline collection in progress
  LED_SOLID,        // baseline loaded, monitoring normally
  LED_HEARTBEAT,    // baseline loaded AND this box is the gateway (set via setGateway)
};

void updateLed();          // call every loop(): drive the LED for the current state
void recomputeLedState();  // call when baseline/node state changes
void setGateway(bool);    // set/clear the gateway flag (e.g. restore from NVS)
bool toggleGateway();     // flip the gateway flag; returns the new state

#endif
