// WiFiManager.cpp
#include <WiFi.h>
#include "WiFiManager.h"
#include "secrets.h"

void connectToWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected!");
}

bool isWiFiConnected() {
  return WiFi.status() == WL_CONNECTED;
}
