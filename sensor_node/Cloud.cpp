#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "Cloud.h"
#include "GtsRootR4.h"
#include "secrets.h"

// Long-lived objects so the TLS session / connection can be reused across
// requests (cheaper than a fresh handshake every 5 s batch).
static WiFiClientSecure client;
static HTTPClient        http;
static bool              connected = false;
static bool              clockReady = false;

void cloudStop() {
  connected = false;
  clockReady = false;
  WiFi.disconnect();
  Serial.println("[cloud] gateway off — WiFi disconnected");
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

// ONE connect attempt (max ~15 s, plus up to 10 s for NTP). Safe to call
// repeatedly — retrying until the AP answers is the cloud task's job, so a
// boot-time outage, bad credentials, or runtime AP blip all self-heal.
bool cloudConnectOnce() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("[cloud] connecting to WiFi");
    unsigned long t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
      delay(500);
      Serial.print(".");
    }
    Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " FAILED");
  }

  if (WiFi.status() != WL_CONNECTED) {
    connected = false;
    return false;
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
