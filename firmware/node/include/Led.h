#ifndef LED_H
#define LED_H

// Runtime role/baseline state. Button feedback temporarily overrides it.
enum LedState {
  LED_OFF,                  // sensor node without a baseline
  LED_GATEWAY_NO_BASELINE,  // brief flash: Gateway waiting for a baseline
  LED_FAST_BLINK,           // baseline collection in progress
  LED_SOLID,                // sensor node monitoring normally
  LED_HEARTBEAT,            // Gateway monitoring normally
};

enum ButtonIndicator {
  BUTTON_INDICATOR_NONE,
  BUTTON_GATEWAY_READY,  // Gateway-toggle hold reached: medium blink
  BUTTON_RESET_READY,    // full-reset hold reached: slow blink
};

void updateLed();
void setButtonIndicator(ButtonIndicator indicator);
void recomputeLedState();
void setGateway(bool enabled);
bool toggleGateway();            // deliberate change (serial 'g')
bool toggleGatewayFromButton();  // refuses to promote a node serving a master
bool isThisGateway();
bool wasServedAsSlave();         // true once this node has answered a master
void markServedAsSlave();
void saveGatewayToFlash();
void loadGatewayFromFlash();

#endif
