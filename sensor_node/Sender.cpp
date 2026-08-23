#include <math.h>       // isnan
#include <string.h>     // strncpy, memset
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "Config.h"
#include "Identity.h"   // nodeMac
#include "Sender.h"
#include "Cloud.h"      // cloudInit / cloudPostJson / cloudGetJson
#include "Alarm.h"      // setThresholdDeg()
#include "secrets.h"

// ---------------------------------------------------------------------------
// Messages across the task boundary (the main loop only enqueues these).
// ---------------------------------------------------------------------------
typedef struct {
  char     mac[18];
  uint8_t  channel;
  float    tilt, g, temp;
  uint32_t n, fail;
  bool     alert;
} ReadingMsg;

typedef struct {
  uint8_t kind;      // 0 = alert, 1 = baseline
  char    mac[18];
  uint8_t channel;
  float   a, b, c;   // alert: value=a;  baseline: bx=a, by=b, bz=c
  char    s1[12];    // alert: kind;     baseline: unused
  char    s2[12];    // alert: severity; baseline: unused
} EventMsg;

static QueueHandle_t readingQueue = nullptr;
static QueueHandle_t eventQueue   = nullptr;
static TaskHandle_t  cloudHandle  = nullptr;

// ---------------------------------------------------------------------------
// JSON building + HTTP (BLOCKING — runs only inside the cloud task).
// ---------------------------------------------------------------------------

static void postBatch(ReadingMsg* batch, int count) {
  String body = "{\"batch\":[";
  for (int i = 0; i < count; i++) {
    // JSON forbids NaN — coerce to 0 so one bad read can't invalidate the body.
    float tilt = isnan(batch[i].tilt) ? 0.0f : batch[i].tilt;
    float g    = isnan(batch[i].g)    ? 0.0f : batch[i].g;
    float temp = isnan(batch[i].temp) ? 0.0f : batch[i].temp;

    if (i) body += ",";
    body += "{\"mac\":\"";   body += batch[i].mac;  body += "\",\"channel\":";
    body += String((uint32_t)batch[i].channel);
    body += ",\"tilt\":";     body += String(tilt, 3);
    body += ",\"g_mag\":";    body += String(g, 3);
    body += ",\"temp_c\":";   body += String(temp, 1);
    body += ",\"n\":";        body += String((uint32_t)batch[i].n);
    body += ",\"fail\":";     body += String((uint32_t)batch[i].fail);
    body += ",\"alert_flag\":"; body += batch[i].alert ? "true" : "false";
    body += "}";
  }
  body += "]}";

  String url = String(SUPABASE_URL) + "/rest/v1/rpc/insert_readings";
  if (cloudPostJson(url.c_str(), body)) {
    Serial.print("[cloud] posted "); Serial.print(count); Serial.println(" readings");
  } else {
    Serial.print("[cloud] POST failed ("); Serial.print(count);
    Serial.print(" readings, len="); Serial.print(body.length());
    Serial.println(")");
  }
}

static void postAlertEvent(const EventMsg& ev) {
  float v = isnan(ev.a) ? 0.0f : ev.a;
  String body = "{\"p_mac\":\"" + String(ev.mac) + "\",\"p_channel\":" + String((uint32_t)ev.channel) +
                ",\"p_kind\":\"" + ev.s1 + "\",\"p_severity\":\"" + ev.s2 +
                "\",\"p_value\":" + String(v, 3) + "}";
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/insert_alert";
  cloudPostJson(url.c_str(), body);
}

static void postBaselineEvent(const EventMsg& ev) {
  float x = isnan(ev.a) ? 0.0f : ev.a;
  float y = isnan(ev.b) ? 0.0f : ev.b;
  float z = isnan(ev.c) ? 0.0f : ev.c;
  String body = "{\"p_mac\":\"" + String(ev.mac) + "\",\"p_channel\":" + String((uint32_t)ev.channel) +
                ",\"p_bx\":" + String(x, 4) +
                ",\"p_by\":" + String(y, 4) +
                ",\"p_bz\":" + String(z, 4) + "}";
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/upsert_baseline";
  cloudPostJson(url.c_str(), body);
}

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

// ---------------------------------------------------------------------------
// The cloud task — owns WiFi + all HTTP. Blocking here is fine: it's a separate
// task, so the main loop's sampling / RS-485 / button / LED / alarm never wait.
// ---------------------------------------------------------------------------
static void cloudTask(void*) {
  cloudInit();            // WiFi connect (blocking, but only this task)
  fetchThreshold();
  unsigned long lastConfig = millis();

  ReadingMsg batch[SENDER_MAX_QUEUE];
  int count = 0;
  unsigned long batchStart = millis();

  for (;;) {
    // Immediate events first (alerts / baselines).
    EventMsg ev;
    while (xQueueReceive(eventQueue, &ev, 0) == pdTRUE) {
      if (ev.kind == 0) postAlertEvent(ev);
      else              postBaselineEvent(ev);
    }

    // Drain readings into a batch (up to SENDER_MAX_QUEUE, or until the
    // SENDER_BATCH_MS window elapses).
    ReadingMsg r;
    while (count < SENDER_MAX_QUEUE &&
           xQueueReceive(readingQueue, &r, pdMS_TO_TICKS(50)) == pdTRUE) {
      batch[count++] = r;
      if (millis() - batchStart >= SENDER_BATCH_MS) break;
    }

    if (count > 0 && (count >= SENDER_MAX_QUEUE || millis() - batchStart >= SENDER_BATCH_MS)) {
      postBatch(batch, count);
      count = 0;
      batchStart = millis();
    }

    // Re-poll the threshold occasionally.
    if (millis() - lastConfig >= CONFIG_POLL_MS) {
      lastConfig = millis();
      fetchThreshold();
    }

    taskYIELD();
  }
}

// ---------------------------------------------------------------------------
// Public API (main-loop side — non-blocking, microseconds).
// ---------------------------------------------------------------------------

void senderInit() {
  if (cloudHandle) return;   // idempotent — only start the task once
  readingQueue = xQueueCreate(SENDER_MAX_QUEUE * 2, sizeof(ReadingMsg));
  eventQueue   = xQueueCreate(16, sizeof(EventMsg));
  xTaskCreatePinnedToCore(cloudTask, "cloud", 10240, NULL, 1, &cloudHandle, 0);
}

void senderAddReading(const char* mac, uint8_t channel, float tilt, float g,
                      float temp, uint32_t n, uint32_t fail, bool alertFlag) {
  if (!readingQueue) return;
  ReadingMsg r;
  strncpy(r.mac, mac, sizeof r.mac - 1);
  r.mac[sizeof r.mac - 1] = '\0';
  r.channel = channel; r.tilt = tilt; r.g = g; r.temp = temp;
  r.n = n; r.fail = fail; r.alert = alertFlag;
  xQueueSendToBack(readingQueue, &r, 0);   // drop if full — never block the loop
}

void senderPushAlert(const char* mac, uint8_t channel, const char* kind,
                     const char* severity, float value) {
  if (!eventQueue) return;
  EventMsg ev;
  memset(&ev, 0, sizeof ev);
  ev.kind = 0;
  strncpy(ev.mac, mac, sizeof ev.mac - 1);
  strncpy(ev.s1, kind, sizeof ev.s1 - 1);
  strncpy(ev.s2, severity, sizeof ev.s2 - 1);
  ev.channel = channel;
  ev.a = value;
  xQueueSendToBack(eventQueue, &ev, 0);
}

void senderUploadBaseline(const char* mac, uint8_t channel,
                          float bx, float by, float bz) {
  if (!eventQueue) return;
  EventMsg ev;
  memset(&ev, 0, sizeof ev);
  ev.kind = 1;
  strncpy(ev.mac, mac, sizeof ev.mac - 1);
  ev.channel = channel;
  ev.a = bx; ev.b = by; ev.c = bz;
  xQueueSendToBack(eventQueue, &ev, 0);
}