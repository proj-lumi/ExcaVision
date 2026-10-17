#include <Arduino.h>
#include <WiFi.h>
#include <esp_err.h>
#include <nvs_flash.h>
#include "Cloud.h"
#include "Led.h"
#include "Rs485.h"
#include "TestingReset.h"

void completeUnitReset() {
  if (isThisGateway()) {
    Serial.println("[state reset] broadcasting to sensor nodes");
    rs485BroadcastReset();
    delay(100);
  }
  completeTestingReset();
}

void completeTestingReset() {
  Serial.println("[state reset] clearing role, Wi-Fi, baselines, and threshold");

  // Disable Gateway work first so the cloud task cannot write configuration
  // back into NVS while it is being erased.
  setGateway(false);
  cloudStop();
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_OFF);

  // Erase the complete NVS partition rather than relying on a list of known
  // namespaces. This also removes stale settings from older firmware builds.
  const esp_err_t result = nvs_flash_erase();
  if (result != ESP_OK) {
    Serial.print("[state reset] FAILED: ");
    Serial.println(esp_err_to_name(result));
    return;
  }

  Serial.println("[state reset] complete; restarting fresh");
  delay(150);
  ESP.restart();
}
