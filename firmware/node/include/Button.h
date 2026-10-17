#ifndef BUTTON_H
#define BUTTON_H

// Actions recognized by the dedicated field-interface task and consumed by
// the main loop. Recognition stays responsive even when sensor/RS-485 work
// temporarily blocks the main loop; execution remains in the main-loop context.
enum ButtonAction : uint8_t {
  BUTTON_ACTION_NONE,
  BUTTON_ACTION_BASELINE_TOGGLE,
  BUTTON_ACTION_GATEWAY_TOGGLE,
  BUTTON_ACTION_FULL_RESET,
};

// Starts the dedicated GPIO16/GPIO23 task on the Arduino loop core. It polls
// and debounces the button and updates the LED every 5 ms at higher priority
// than loop(), preventing slow peripheral work from losing clicks or jittering
// LED patterns.
void startFieldInterfaceTask();

// Non-blocking: returns one queued release action, or false if none is pending.
bool takeButtonAction(ButtonAction& action);

#endif
