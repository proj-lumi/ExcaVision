#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "Cloud.h"
#include "GtsRootR4.h"
#include "Identity.h"
#include "secrets.h"

// Long-lived objects so the TLS session / connection can be reused across
// requests (cheaper than a fresh handshake every 5 s batch).
static WiFiClientSecure client;
static HTTPClient        http;
static WiFiManager       wifiManager;
static bool              connected = false;
static bool              clockReady = false;
static String            setupApName;

// Every gateway exposes a stable, recognizable setup hotspot. The suffix is
// derived from the factory MAC, so manufactured units need no per-device
// firmware build and installers can match the AP to the serial label.
static String buildSetupApName() {
  String compactMac(nodeMac);
  compactMac.replace(":", "");
  String suffix = compactMac.substring(compactMac.length() - 6);
  return String("ExcaVision-Setup-") + suffix;
}

void cloudStop() {
  connected = false;
  clockReady = false;
  wifiManager.stopConfigPortal();
  WiFi.disconnect();
  WiFi.mode(WIFI_OFF);
  Serial.println("[cloud] gateway off — WiFi/AP stopped");
}

// Synchronize the RTC before TLS certificate validation. A certificate can
// be valid on the calendar but appear invalid to an ESP32 whose clock is 1970.
static bool syncClock() {
  if (clockReady) return true;
  configTime(0, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
  Serial.print("[cloud] synchronizing clock");
  unsigned long t0 = millis();
  time_t now = 0;
  while (now < 1700000000 && millis() - t0 < 10000) {
    delay(250);
    time(&now);
    Serial.print(".");
  }
  clockReady = (now >= 1700000000);
  Serial.println(clockReady ? " synchronized" : " FAILED");
  return clockReady;
}

// Connect with credentials stored by the ESP32 WiFi stack. On first boot—or
// when the saved network cannot be reached—WiFiManager opens a captive portal
// in this task. Sampling and RS-485 continue on the main task while setup waits.
bool cloudConnectOnce() {
  if (WiFi.status() != WL_CONNECTED) {
    if (setupApName.length() == 0) setupApName = buildSetupApName();

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    wifiManager.setConnectTimeout(15);       // try saved credentials first
    wifiManager.setConfigPortalTimeout(300); // then offer setup for five minutes
    wifiManager.setWiFiAutoReconnect(true);

    Serial.print("[wifi] connect to setup hotspot if prompted: ");
    Serial.println(setupApName);
    Serial.println("[wifi] captive portal: http://192.168.4.1");

    // No AP password: commissioning is local and temporary. Credentials entered
    // in the portal are saved in NVS and reused on later boots.
    bool ok = wifiManager.autoConnect(setupApName.c_str());
    if (!ok || WiFi.status() != WL_CONNECTED) {
      connected = false;
      Serial.println("[wifi] setup timed out; will retry");
      return false;
    }

    Serial.print("[wifi] connected to ");
    Serial.print(WiFi.SSID());
    Serial.print(" at ");
    Serial.println(WiFi.localIP());
  }

  // Trust only the pinned Google Trust Services root used by the current
  // Supabase certificate chain. Never fall back to setInsecure().
  client.setCACert(GTS_ROOT_R4);
  connected = syncClock();
  return connected;
}

bool cloudConnected() { return connected; }

bool cloudPostJson(const char* url, const String& jsonBody) {
  if (!connected) return false;
  client.stop();   // reset stale TLS/socket state before each request (ESP32 reuse gotcha)
  http.begin(client, url);
  http.setTimeout(10000);   // 10 s read timeout — the -11 timeouts were 5 s; hurts when the server is briefly slow
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_SECRET_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SECRET_KEY);
  int code = http.POST((uint8_t*)jsonBody.c_str(), jsonBody.length());  // explicit length — String POST can truncate large bodies
  bool ok = (code >= 200 && code < 300);
  if (!ok) {
    Serial.print("[cloud] POST http="); Serial.print(code);
    if (code < 0) { Serial.print(" "); Serial.print(http.errorToString(code)); }
    Serial.print(" resp="); Serial.println(http.getString());
  }
  http.end();
  return ok;
}

bool cloudGetJson(const char* url, String& out) {
  if (!connected) return false;
  client.stop();
  http.begin(client, url);
  http.setTimeout(10000);   // 10 s read timeout (was 5 s)
  http.addHeader("apikey", SUPABASE_SECRET_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SECRET_KEY);
  int code = http.GET();
  bool ok = (code >= 200 && code < 300);
  if (ok) out = http.getString();
  else {
    Serial.print("[cloud] GET http="); Serial.print(code);
    if (code < 0) { Serial.print(" "); Serial.print(http.errorToString(code)); }
    Serial.println();
  }
  http.end();
  return ok;
}
