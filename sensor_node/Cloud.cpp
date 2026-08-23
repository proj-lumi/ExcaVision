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

void cloudInit() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(500);
    Serial.print(".");
  }
  connected = (WiFi.status() == WL_CONNECTED);
  Serial.println(connected ? "\nWiFi connected!" : "\nWiFi FAILED (continuing without cloud)");
  client.setInsecure();   // bench only — pin Supabase's CA cert for production
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
