#include <Arduino.h>
#include <stdio.h>      // snprintf
#include "esp_mac.h"    // esp_efuse_mac_get_default — factory MAC, no WiFi stack pulled in
#include "Identity.h"

char nodeMac[18];

// Read the node's factory-programmed base MAC once and print it at boot.
// Works on every board (master or slave) without WiFi — proven by the
// official ESP32 MacAddress example using this same call.
void initIdentity() {
  uint8_t mac[6];
  esp_efuse_mac_get_default(mac);
  snprintf(nodeMac, sizeof nodeMac, "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  Serial.print("node MAC: ");
  Serial.println(nodeMac);
}