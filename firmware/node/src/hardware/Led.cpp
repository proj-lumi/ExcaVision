#include <Arduino.h>
#include <Preferences.h>
#include "Config.h"
#include "Led.h"
#include "Baseline.h"

static volatile LedState ledState = LED_OFF;
static volatile ButtonIndicator buttonIndicator = BUTTON_INDICATOR_NONE;
static bool gatewayEnabled = false;
static Preferences gatewayPreferences;

// Gateway role is runtime state, not a compile-time identity. Every board can
// use the same firmware; only the board intentionally promoted during local
// commissioning enables WiFi/cloud mode.
bool isThisGateway() { return gatewayEnabled; }

// A node that has answered a master's discovery or poll is a commissioned sensor
// node. Remember that across reboots so neither the button nor serial 'g' can
// promote it into a Gateway and open a setup AP on a live bus.
static bool servedAsSlave = false;

bool wasServedAsSlave() { return servedAsSlave; }

void markServedAsSlave() {
  if (servedAsSlave) return;
  servedAsSlave = true;
  gatewayPreferences.begin("gateway", false);
  gatewayPreferences.putBool("served_as_slave", true);
  gatewayPreferences.end();
  Serial.println("[role] this node is answering a master: it is a sensor node");
}

void saveGatewayToFlash() {
  gatewayPreferences.begin("gateway", false);
  gatewayPreferences.putBool("enabled", gatewayEnabled);
  gatewayPreferences.end();
}

void loadGatewayFromFlash() {
  if (!gatewayPreferences.begin("gateway", false)) {
    gatewayEnabled = false;
    servedAsSlave = false;
    Serial.println("gateway: OFF (role storage unavailable; refusing cloud mode)");
    return;
  }
  gatewayEnabled = gatewayPreferences.getBool("enabled", false);
  servedAsSlave = gatewayPreferences.getBool("served_as_slave", false);
  gatewayPreferences.end();
  Serial.print("gateway: ");
  Serial.println(gatewayEnabled ? "ON" : "OFF");
}

void setGateway(bool enabled) {
  gatewayEnabled = enabled;
  saveGatewayToFlash();
}

bool toggleGateway() {
  setGateway(!gatewayEnabled);
  Serial.println(gatewayEnabled ? "gateway mode ON — setup will start if needed" : "gateway mode OFF");
  return gatewayEnabled;
}

// Button path: refuses to promote a node that is already serving as a sensor
// node on a live bus, which is what opened a setup AP on slave nodes.
bool toggleGatewayFromButton() {
  if (!gatewayEnabled && wasServedAsSlave()) {
    Serial.println("[role] ignored: node is serving a master (full reset before field reassignment)");
    return gatewayEnabled;
  }
  return toggleGateway();
}

void setButtonIndicator(ButtonIndicator indicator) {
  buttonIndicator = indicator;
}

void recomputeLedState() {
  uint8_t presentCount = 0;
  bool allHaveBase = true;
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (!nodes[i].present) continue;
    presentCount++;
    if (!nodes[i].hasBaseline) allHaveBase = false;
  }

  if (baselineCollecting) {
    ledState = LED_FAST_BLINK;
  } else if (presentCount == 0 || !allHaveBase) {
    ledState = isThisGateway() ? LED_GATEWAY_NO_BASELINE : LED_OFF;
  } else {
    ledState = isThisGateway() ? LED_HEARTBEAT : LED_SOLID;
  }
}

void updateLed() {
  const unsigned long now = millis();
  bool on = false;
  if (buttonIndicator == BUTTON_GATEWAY_READY) {
    on = (now % 500) < 250;        // medium blink while Gateway toggle is ready
  } else if (buttonIndicator == BUTTON_RESET_READY) {
    on = (now % 1000) < 500;       // slower blink until release performs the reset
  } else {
    switch (ledState) {
      case LED_OFF:                 on = false;                     break;
      case LED_GATEWAY_NO_BASELINE: on = (now % 2000) < 100;        break;
      case LED_SOLID:               on = true;                      break;
      case LED_FAST_BLINK:          on = (now % 200) < 100;         break;
      case LED_HEARTBEAT:           on = (now % 2000) < 1900;       break;
    }
  }
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}
