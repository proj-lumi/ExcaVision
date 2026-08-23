#include <math.h>       // isnan — JSON must not contain NaN
#include "Config.h"
#include "Identity.h"   // nodeMac
#include "Sender.h"
#include "Cloud.h"
#include "Alarm.h"      // setThresholdDeg()
#include "secrets.h"

// ---------------------------------------------------------------------------
// Pending-reading buffer (bounded; flushes every SENDER_BATCH_MS).
// ---------------------------------------------------------------------------
struct PendingReading {
  char     mac[18];
  uint8_t  channel;
  float    tilt, g, temp;
  uint32_t n, fail;
  bool     alert;
};

static PendingReading queue[SENDER_MAX_QUEUE];
static uint16_t       qCount     = 0;
static unsigned long  lastFlush  = 0;
static unsigned long  lastConfig = 0;

// Build the JSON batch and POST it. On success, clear the buffer. On failure,
// keep it and retry next tick (bounded by SENDER_MAX_QUEUE).
static void flush() {
  if (qCount == 0) return;

  String batch = "[";
  for (uint16_t i = 0; i < qCount; i++) {
    // JSON forbids NaN — coerce to 0 so one bad read can't invalidate the body.
    float tilt = isnan(queue[i].tilt) ? 0.0f : queue[i].tilt;
    float g    = isnan(queue[i].g)    ? 0.0f : queue[i].g;
    float temp = isnan(queue[i].temp) ? 0.0f : queue[i].temp;

    if (i) batch += ",";
    batch += "{\"mac\":\"";   batch += queue[i].mac;  batch += "\",\"channel\":";
    batch += String((uint32_t)queue[i].channel);   // decimal string, NOT a raw byte
    batch += ",\"tilt\":";     batch += String(tilt, 3);
    batch += ",\"g_mag\":";    batch += String(g, 3);
    batch += ",\"temp_c\":";   batch += String(temp, 1);
    batch += ",\"n\":";        batch += String((uint32_t)queue[i].n);
    batch += ",\"fail\":";     batch += String((uint32_t)queue[i].fail);
    batch += ",\"alert_flag\":"; batch += queue[i].alert ? "true" : "false";
    batch += "}";
  }
  batch += "]";

  String body = "{\"batch\":" + batch + "}";
  String url  = String(SUPABASE_URL) + "/rest/v1/rpc/insert_readings";

  if (cloudPostJson(url.c_str(), body)) {
    Serial.print("[cloud] posted "); Serial.print(qCount); Serial.println(" readings");
    qCount = 0;
  } else {
    Serial.print("[cloud] POST failed ("); Serial.print(qCount);
    Serial.print(" queued, len="); Serial.print(body.length());
    Serial.println(", retrying)");
  }
}

void senderAddReading(const char* mac, uint8_t channel,
                      float tilt, float g, float temp,
                      uint32_t n, uint32_t fail, bool alertFlag) {
  if (qCount >= SENDER_MAX_QUEUE) flush();   // buffer full -> send early
  if (qCount >= SENDER_MAX_QUEUE) return;    // still full (send failed) -> drop

  PendingReading& r = queue[qCount++];
  strncpy(r.mac, mac, sizeof r.mac - 1);
  r.mac[sizeof r.mac - 1] = '\0';
  r.channel = channel;
  r.tilt = tilt; r.g = g; r.temp = temp;
  r.n = n; r.fail = fail; r.alert = alertFlag;
}

void senderPushAlert(const char* mac, uint8_t channel,
                     const char* kind, const char* severity, float value) {
  float v = isnan(value) ? 0.0f : value;
  // body keys must match the function's p_ prefixed params (PostgREST maps
  // JSON keys to parameter names)
  String body = "{\"p_mac\":\"" + String(mac) + "\",\"p_channel\":" + String((uint32_t)channel) +
                ",\"p_kind\":\"" + kind + "\",\"p_severity\":\"" + severity +
                "\",\"p_value\":" + String(v, 3) + "}";
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/insert_alert";
  cloudPostJson(url.c_str(), body);
}

void senderUploadBaseline(const char* mac, uint8_t channel,
                          float bx, float by, float bz) {
  float x = isnan(bx) ? 0.0f : bx;
  float y = isnan(by) ? 0.0f : by;
  float z = isnan(bz) ? 0.0f : bz;
  // body keys must match the function's p_ prefixed params
  String body = "{\"p_mac\":\"" + String(mac) + "\",\"p_channel\":" + String((uint32_t)channel) +
                ",\"p_bx\":" + String(x, 4) +
                ",\"p_by\":" + String(y, 4) +
                ",\"p_bz\":" + String(z, 4) + "}";
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/upsert_baseline";
  cloudPostJson(url.c_str(), body);
}

// Poll the node's config (pipe threshold) from Supabase and apply it. The
// response is a PostgREST array like [{"threshold_deg":2.0}]; we extract the
// number after "threshold_deg".
static void fetchThreshold() {
  String url = String(SUPABASE_URL) + "/rest/v1/node_config?mac=eq." +
               String(nodeMac) + "&select=threshold_deg";
  String out;
  if (cloudGetJson(url.c_str(), out)) {
    int idx = out.indexOf("threshold_deg");
    if (idx >= 0) {
      idx = out.indexOf(':', idx);
      if (idx >= 0) {
        float t = out.substring(idx + 1).toFloat();
        if (t > 0) setThresholdDeg(t);
      }
    }
  }
}

void senderInit() {
  lastConfig = millis();
  fetchThreshold();
}

void senderTick() {
  unsigned long now = millis();
  if (now - lastFlush >= SENDER_BATCH_MS) {
    lastFlush = now;
    flush();
  }
  if (now - lastConfig >= CONFIG_POLL_MS) {
    lastConfig = now;
    fetchThreshold();
  }
}
