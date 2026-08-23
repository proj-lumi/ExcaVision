#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "Cloud.h"
#include "secrets.h"

// Long-lived objects so the TLS session / connection can be reused across
// requests (cheaper than a fresh handshake every 5 s batch).
static WiFiClientSecure client;
static HTTPClient        http;
static bool              connected = false;

void cloudStop() {
  connected = false;
  WiFi.disconnect();
  Serial.println("[cloud] gateway off — WiFi disconnected");
}

// ONE connect attempt (max ~15 s). Safe to call repeatedly — retrying until
// the AP answers is the cloud task's job, so a boot-time outage, bad
// credentials, or a runtime AP blip all self-heal. Never gate the main loop.
bool cloudConnectOnce() {
  if (WiFi.status() == WL_CONNECTED) { connected = true; return true; }
  client.setInsecure();   // bench only — pin Supabase's CA cert for production
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[cloud] connecting to WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(500);
    Serial.print(".");
  }
  connected = (WiFi.status() == WL_CONNECTED);
  if (connected) Serial.println(" connected");
  else           Serial.println();
  return connected;
}

bool cloudConnected() { return connected; }

bool cloudPostJson(const char* url, const String& jsonBody) {
  if (!connected) return false;
  client.stop();   // reset stale TLS/socket state before each request (ESP32 reuse gotcha)
  http.begin(client, url);
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
