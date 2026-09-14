#include <Arduino.h>
#include "Config.h"
#include "Button.h"
#include "Baseline.h"   // doBaselineSet()  (short press) — global capture on the gateway
#include "Led.h"        // setGateway()  (long press)

// Button debounce + edge detection state (internal to this module).
static bool          btnLastRaw    = HIGH; // last raw pin reading
static bool          btnStable     = HIGH; // debounced (trusted) reading
static unsigned long btnLastChange = 0;    // when the raw pin last changed
static unsigned long pressStart    = 0;    // when the press began
static bool          longPressFired = false;  // gateway already set for THIS press

// Call every loop(). Debounces the button and detects press/release edges.
// A short press triggers the global baseline capture (doBaselineSet): on the
// gateway that also broadcasts `C` so every slave captures simultaneously.
void pollButton() {
  bool raw = digitalRead(BUTTON_PIN);

  // Any change in the raw pin resets the debounce timer.
  if (raw != btnLastRaw) {
    btnLastRaw = raw;
    btnLastChange = millis();
  }

  // Only after the pin has been stable for 30 ms do we trust the change.
  if ((millis() - btnLastChange) >= 30 && raw != btnStable) {
    btnStable = raw;   // a real, debounced edge happened

    if (btnStable == LOW) {
      // Press started — remember when.
      pressStart = millis();
      longPressFired = false;   // a fresh press starts with no long-press yet
    } else {
      // Released — how long was it held?
      unsigned long held = millis() - pressStart;
      if (held < SHORT_PRESS_MS) {
        doBaselineSet();   // SHORT press -> capture baseline (global on the gateway)
      }
      // (holds between 1 s and 3 s do nothing — the dead zone)
    }
  }

  // While still held, fire the long-press at GATEWAY_HOLD_MS (once per press).
  // It TOGGLES the gateway flag: hold to become the master, or hold again to
  // return to a normal sensor node. The LED flips to/from the heartbeat right
  // then, so the operator sees the 3-second hold succeed without releasing.
  if (btnStable == LOW && !longPressFired &&
      (millis() - pressStart) >= GATEWAY_HOLD_MS) {
    longPressFired = true;
    toggleGateway();   // prints the new gateway state itself
  }
}
