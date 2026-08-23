#include <math.h>       // isnan
#include <string.h>     // strncpy, memset
#include <stdlib.h>     // atof, atoi, strtol
#include <WiFi.h>       // WiFi.status() — the task owns the WiFi lifecycle
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "Config.h"
#include "Identity.h"   // nodeMac
#include "Led.h"        // isThisGateway() — the task idles when not the gateway
#include "Sender.h"
#include "Cloud.h"      // cloudConnectOnce / cloudStop / cloudPostJson / cloudGetJson
#include "Alarm.h"      // setThresholdDeg()
#include "Baseline.h"   // anyPresentBaseline() / saveBaselinesToFlash() (NVS-empty recovery)
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
  uint8_t kind;      // 0 = alert, 1 = baseline upload, 2 = fetch a slave's baselines
  char    mac[18];
  uint8_t channel;
  float   a, b, c;   // alert: value=a;  baseline: bx=a, by=b, bz=c
  char    s1[12];    // alert: kind;     baseline: unused
  char    s2[12];    // alert: severity; baseline: unused
} EventMsg;

static QueueHandle_t readingQueue = nullptr;
static QueueHandle_t eventQueue   = nullptr;
static TaskHandle_t  cloudHandle  = nullptr;

// A threshold changed by the app/cloud task, pending relay to the slaves by
// the main loop. All RS-485 TX stays in the main-loop context, so the cloud
// task only FLAGS it here. volatile: set on core 0, read on core 1.
static volatile bool  threshPending;        // a new threshold needs forwarding
static volatile float threshPendingValue;

// A slave's baselines fetched by the cloud task, staged for the main loop to
// relay back to the requesting slave (Q; frame). Same cross-core handoff.
static volatile SenderBaseline replyBuf[NUM_SENSORS];
static volatile int            replyCount;
static volatile bool           replyPending;
static char                    replyMac[18];

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
  if (cloudPostJson(url.c_str(), body)) {
    Serial.print("[cloud] alert posted "); Serial.print(ev.mac);
    Serial.print(" ch"); Serial.println(ev.channel);
  } else {
    Serial.print("[cloud] alert POST FAILED "); Serial.print(ev.mac);
    Serial.print(" ch"); Serial.println(ev.channel);
  }
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
  if (cloudPostJson(url.c_str(), body)) {
    Serial.print("[cloud] baseline posted "); Serial.print(ev.mac);
    Serial.print(" ch"); Serial.println(ev.channel);
  } else {
    Serial.print("[cloud] baseline POST FAILED "); Serial.print(ev.mac);
    Serial.print(" ch"); Serial.println(ev.channel);
  }
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
        // Apply a change locally and flag it for relay to the slaves: the
        // main loop broadcasts `T;` so every node's LOCAL alarm stays in sync.
        if (t > 0 && t != getThresholdDeg()) {
          setThresholdDeg(t);
          threshPending      = true;
          threshPendingValue = t;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cloud baseline recovery (spec §7.2, NVS-empty path).
// ---------------------------------------------------------------------------

// Parse the PostgREST JSON array get_current_baselines returns:
//   [{"channel":7,"bx":..,"by":..,"bz":..}, ...]
static int parseBaselinesJson(const char* js, SenderBaseline* out, int maxCount) {
  int n = 0;
  const char* p = js;
  while (n < maxCount && (p = strchr(p, '{')) != nullptr) {
    const char* end = strchr(p, '}');
    if (!end) break;
    const char* colon;
    if (const char* c = strstr(p, "\"channel\"")) {
      if (c < end && (colon = strchr(c, ':')) && colon < end) out[n].channel = (uint8_t)atoi(colon + 1);
    }
    if (const char* x = strstr(p, "\"bx\"")) {
      if (x < end && (colon = strchr(x, ':')) && colon < end) out[n].bx = (float)atof(colon + 1);
    }
    if (const char* y = strstr(p, "\"by\"")) {
      if (y < end && (colon = strchr(y, ':')) && colon < end) out[n].by = (float)atof(colon + 1);
    }
    if (const char* z = strstr(p, "\"bz\"")) {
      if (z < end && (colon = strchr(z, ':')) && colon < end) out[n].bz = (float)atof(colon + 1);
    }
    n++;
    p = end + 1;
  }
  return n;
}

// GET a MAC's current baselines from the cloud; returns the count parsed.
static int fetchBaselinesFromCloud(const char* mac, SenderBaseline* out, int maxCount) {
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/get_current_baselines?mac=" + String(mac);
  String js;
  if (!cloudGetJson(url.c_str(), js)) {
    Serial.println("[cloud] baseline fetch FAILED");
    return 0;
  }
  return parseBaselinesJson(js.c_str(), out, maxCount);
}

// Master/gateway: if NVS had no baselines, recover this node's own from
// Supabase (boot path). No-op once any sensor has a baseline.
static void maybeRecoverOwnBaselines() {
  if (anyPresentBaseline()) return;            // NVS already has the reference
  SenderBaseline list[NUM_SENSORS];
  int count = fetchBaselinesFromCloud(nodeMac, list, NUM_SENSORS);
  if (count == 0) return;
  bool applied = false;
  for (int k = 0; k < count; k++) {
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      if (nodes[i].present && SENSORS[i].channel == list[k].channel) {
        nodes[i].bx = list[k].bx; nodes[i].by = list[k].by; nodes[i].bz = list[k].bz;
        nodes[i].hasBaseline = true;
        applied = true;
      }
    }
  }
  if (applied) {
    saveBaselinesToFlash();
    Serial.println("[cloud] recovered own baselines from Supabase");
  }
}

// Master/gateway: a slave asked (F;) for its baselines. Fetch them from the
// cloud and stage a reply for the main loop to send back (Q; frame).
static void handleBaselineFetch(const EventMsg& ev) {
  SenderBaseline list[NUM_SENSORS];
  int count = fetchBaselinesFromCloud(ev.mac, list, NUM_SENSORS);
  strncpy(replyMac, ev.mac, sizeof replyMac - 1);
  replyMac[sizeof replyMac - 1] = '\0';
  int n = count; if (n > NUM_SENSORS) n = NUM_SENSORS;
  for (int i = 0; i < n; i++) {
    replyBuf[i].channel = list[i].channel;
    replyBuf[i].bx = list[i].bx; replyBuf[i].by = list[i].by; replyBuf[i].bz = list[i].bz;
  }
  replyCount  = n;
  replyPending = true;
  Serial.print("[cloud] fetched "); Serial.print(n); Serial.print(" baselines for "); Serial.println(ev.mac);
}

// ---------------------------------------------------------------------------
// The cloud task — owns WiFi + all HTTP. Blocking here is fine: it's a separate
// task, so the main loop's sampling / RS-485 / button / LED / alarm never wait.
//
// WiFi lifecycle lives HERE, not in the main loop or in senderInit():
//   - connect retries forever (10 s apart) until the AP answers, so wrong or
//     temporary credentials at boot self-heal — no untoggle/retoggle needed;
//   - a runtime AP drop is detected (WiFi.status) and reconnected;
//   - if the box stops being the gateway (long-press off), WiFi disconnects
//     and the task idles silently until promotion again.
// ---------------------------------------------------------------------------
static void cloudTask(void*) {
  unsigned long lastConfig = millis();

  ReadingMsg batch[SENDER_MAX_QUEUE];
  int count = 0;
  unsigned long batchStart = millis();

  for (;;) {
    // Role + link lifecycle (our own core — never the main loop).
    if (!isThisGateway()) {
      if (WiFi.status() == WL_CONNECTED) cloudStop();
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    if (WiFi.status() != WL_CONNECTED) {
      if (!cloudConnectOnce()) {
        vTaskDelay(pdMS_TO_TICKS(10000));   // retry in 10 s — never give up
        continue;
      }
      fetchThreshold();          // freshly connected: pull the threshold
      maybeRecoverOwnBaselines(); // NVS-empty gateway: recover its own baselines
      lastConfig = millis();
    }

    // Immediate events first (alerts / baselines).
    EventMsg ev;
    while (xQueueReceive(eventQueue, &ev, 0) == pdTRUE) {
      if (ev.kind == 0) postAlertEvent(ev);
      else if (ev.kind == 1) postBaselineEvent(ev);
      else if (ev.kind == 2) handleBaselineFetch(ev);   // a slave asked for its baselines
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
  eventQueue   = xQueueCreate(32, sizeof(EventMsg));   // 32 slots for alerts/baselines (was 16)
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
  if (xQueueSendToBack(eventQueue, &ev, 0) != pdTRUE) {
    Serial.print("[cloud] ALERT DROPPED (queue full) "); Serial.print(mac);
    Serial.print(" ch"); Serial.println(channel);
  }
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
  if (xQueueSendToBack(eventQueue, &ev, 0) != pdTRUE) {
    Serial.print("[cloud] BASELINE DROPPED (queue full) "); Serial.print(mac);
    Serial.print(" ch"); Serial.println(channel);
  }
}

// The main loop polls this: consumes a pending threshold-change (fetched by
// the cloud task) so it can broadcast `T;` to the slaves. Returns true with
// the new value on a change, false otherwise.
bool senderTakeThresholdChange(float& value) {
  if (!threshPending) return false;
  threshPending = false;
  value = threshPendingValue;
  return true;
}

// Main loop: ask the cloud task to fetch <mac>'s baselines (a slave relayed
// `F;`). Enqueued; the task does the blocking HTTP + parsing.
void senderFetchBaselines(const char* mac) {
  if (!eventQueue) return;
  EventMsg ev; memset(&ev, 0, sizeof ev);
  ev.kind = 2;
  strncpy(ev.mac, mac, sizeof ev.mac - 1);
  if (xQueueSendToBack(eventQueue, &ev, 0) != pdTRUE)
    Serial.println("[cloud] baseline-fetch DROPPED (queue full)");
}

// Main loop: consume a staged baseline fetch; returns true once with the
// target MAC + list so the caller can relay them back as a Q; frame.
bool senderTakeBaselineReply(char* macOut, SenderBaseline* out, int& count) {
  if (!replyPending) return false;
  int n = replyCount; if (n > NUM_SENSORS) n = NUM_SENSORS;
  strncpy(macOut, replyMac, 17); macOut[17] = '\0';
  for (int i = 0; i < n; i++) {
    out[i].channel = replyBuf[i].channel;
    out[i].bx = replyBuf[i].bx; out[i].by = replyBuf[i].by; out[i].bz = replyBuf[i].bz;
  }
  count = n;
  replyPending = false;
  return true;
}