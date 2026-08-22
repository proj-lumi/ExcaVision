#include <Arduino.h>
#include "Config.h"
#include "Button.h"
#include "Baseline.h"   // startBaselineCapture()  (short press)

// Button debounce + edge detection state (internal to this module).
static bool          btnLastRaw    = HIGH; // last raw pin reading
static bool          btnStable     = HIGH; // debounced (trusted) reading
static unsigned long btnLastChange = 0;    // when the raw pin last changed
static unsigned long pressStart    = 0;    // when the press began

// Call every loop(). Debounces the button and detects press/release edges.
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
    } else {
      // Released — how long was it held?
      unsigned long held = millis() - pressStart;
      if (held < SHORT_PRESS_MS) {
        startBaselineCapture();   // SHORT press -> collect baseline for 30 s
      }
      // (long-press -> gateway comes in a later step; for now longer holds do nothing.
      //  When that step lands, add: `#include "Led.h"` and
      //  `else if (held >= 3000) setGateway(true);` here.)
    }
  }
}
