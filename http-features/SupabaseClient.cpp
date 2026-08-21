#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "SupabaseClient.h"
#include "WiFiManager.h"
#include "Config.h"
#include "secrets.h"

void sendReadingToSupabase(const SensorReading &reading) {
  if (!isWiFiConnected()) {
    Serial.println("[Supabase] Skipped send - WiFi not connected");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // OK for testing; use a proper root CA for production

  HTTPClient http;
  http.begin(client, SUPABASE_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  char payload[192];
  snprintf(payload, sizeof(payload),
    "{\"device_id\":\"esp32-01\",\"accel_x\":%d,\"accel_y\":%d,\"accel_z\":%d,\"pitch_deg\":%.2f,\"roll_deg\":%.2f}",
    reading.ax, reading.ay, reading.az, reading.pitch, reading.roll);

  int httpCode = http.POST(payload);

  if (httpCode == 200 || httpCode == 201) {
    Serial.println("[Supabase] Insert successful");
  } else if (httpCode > 0) {
    Serial.print("[Supabase] Request rejected (");
    Serial.print(httpCode);
    Serial.println(")");
    #if DEBUG_MODE
    Serial.println(http.getString());
    #endif
  } else {
    Serial.print("[Supabase] Connection failed: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
}
