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
#include "Environment.generated.h"

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
  uint8_t tries;     // upload retry counter (never silently lose alerts/baselines)
} EventMsg;

static QueueHandle_t readingQueue = nullptr;
static QueueHandle_t eventQueue   = nullptr;
static TaskHandle_t  cloudHandle  = nullptr;

// Per mac+channel upload state. Change-driven uploads keep the dashboard live
// during movement while a static sensor costs one heartbeat every
// SENDER_UPLOAD_HEARTBEAT_MS instead of a reading every second.
typedef struct {
  char     mac[18];
  uint8_t  channel;
  float    tilt;
  uint32_t sentAt;
} UploadTrack;
static UploadTrack uploadTrack[SENDER_TRACK_MAX];
static uint8_t     uploadTrackCount = 0;

// Link health for the stall recovery. A request that *returns* (success or
// failure) counts as progress; only a request that never returns looks like a
// stall, which is the ESP32 TLS/socket hang we have to recover from by hand.
static volatile uint32_t lastCloudProgressMs = 0;
static volatile uint32_t droppedReadings = 0;
static uint32_t          lastStallRecoveryMs = 0;

static void noteCloudProgress() { lastCloudProgressMs = millis(); }

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

static bool postBatch(ReadingMsg* batch, int count) {
  String body = "{\"readings\":[";
  for (int i = 0; i < count; i++) {
    // JSON forbids NaN — coerce to 0 so one bad read can't invalidate the body.
    float tilt = isnan(batch[i].tilt) ? 0.0f : batch[i].tilt;
    float g    = isnan(batch[i].g)    ? 0.0f : batch[i].g;
    float temp = isnan(batch[i].temp) ? 0.0f : batch[i].temp;

    if (i) body += ",";
    body += "{\"mac_address\":\""; body += batch[i].mac; body += "\",\"hardware_channel\":";
    body += String((uint32_t)batch[i].channel);
    body += ",\"tilt_deg\":"; body += String(tilt, 3);
    body += ",\"gravity_magnitude_g\":"; body += String(g, 3);
    body += ",\"temperature_c\":"; body += String(temp, 1);
    body += ",\"sample_count\":"; body += String((uint32_t)batch[i].n);
    body += ",\"failure_count\":"; body += String((uint32_t)batch[i].fail);
    body += ",\"alert_flag\":"; body += batch[i].alert ? "true" : "false";
    body += "}";
  }
  body += "]}";

  String url = String(SUPABASE_URL) + "/functions/v1/node-telemetry/readings";
  const bool ok = cloudPostJson(url.c_str(), body);
  noteCloudProgress();
  if (ok) {
    Serial.print("[cloud] posted "); Serial.print(count); Serial.println(" readings");
    return true;
  }
  Serial.print("[cloud] POST failed ("); Serial.print(count);
  Serial.print(" readings, len=" ); Serial.print(body.length());
  Serial.println(")");
  return false;
}

static void postAlertEvent(const EventMsg& ev) {
  float v = isnan(ev.a) ? 0.0f : ev.a;
  String body = "{\"mac_address\":\"" + String(ev.mac) + "\",\"hardware_channel\":" +
                String((uint32_t)ev.channel) + ",\"observed_value_deg\":" + String(v, 3) + "}";
  String url = String(SUPABASE_URL) + "/functions/v1/node-telemetry/alert";
  const bool posted = cloudPostJson(url.c_str(), body);
  noteCloudProgress();
  if (posted) {
    Serial.print("[cloud] alert posted "); Serial.print(ev.mac);
    Serial.print(" ch"); Serial.println(ev.channel);
  } else {
    Serial.print("[cloud] alert POST FAILED "); Serial.print(ev.mac);
    Serial.print(" ch"); Serial.println(ev.channel);
    // Alerts matter — if this was a transient timeout/network blip, re-queue
    // and try again (bounded). Never silently lose a safety event.
    if (ev.tries < BASELINE_UPLOAD_RETRIES) {
      EventMsg retry = ev;
      retry.tries++;
      if (xQueueSendToFront(eventQueue, &retry, 0) == pdTRUE) {
        Serial.print("[cloud] alert retry "); Serial.println((int)retry.tries);
      } else {
        Serial.println("[cloud] alert retry re-queue FAILED — dropped");
      }
    } else {
      Serial.println("[cloud] alert dropped after retries");
    }
  }
}

static void postBaselineEvent(const EventMsg& ev) {
  float x = isnan(ev.a) ? 0.0f : ev.a;
  float y = isnan(ev.b) ? 0.0f : ev.b;
  float z = isnan(ev.c) ? 0.0f : ev.c;
  String body = "{\"mac_address\":\"" + String(ev.mac) + "\",\"hardware_channel\":" +
                String((uint32_t)ev.channel) + ",\"baseline_x\":" + String(x, 4) +
                ",\"baseline_y\":" + String(y, 4) +
                ",\"baseline_z\":" + String(z, 4) + "}";
  String url = String(SUPABASE_URL) + "/functions/v1/node-telemetry/baseline";
  const bool posted = cloudPostJson(url.c_str(), body);
  noteCloudProgress();
  if (posted) {
    Serial.print("[cloud] baseline posted "); Serial.print(ev.mac);
    Serial.print(" ch"); Serial.println(ev.channel);
  } else {
    Serial.print("[cloud] baseline POST FAILED "); Serial.print(ev.mac);
    Serial.print(" ch"); Serial.println(ev.channel);
    // A lost baseline would silently re-zero history — re-queue and retry
    // (bounded) so a transient timeout can't drop the reference.
    if (ev.tries < BASELINE_UPLOAD_RETRIES) {
      EventMsg retry = ev;
      retry.tries++;
      if (xQueueSendToFront(eventQueue, &retry, 0) == pdTRUE) {
        Serial.print("[cloud] baseline retry "); Serial.println((int)retry.tries);
      } else {
        Serial.println("[cloud] baseline retry re-queue FAILED — dropped");
      }
    } else {
      Serial.println("[cloud] baseline dropped after retries");
    }
  }
}

static void fetchThreshold() {
  String url = String(SUPABASE_URL) + "/functions/v1/node-telemetry/config?mac_address=" +
               String(nodeMac);
  String out;
  const bool fetched = cloudGetJson(url.c_str(), out);
  noteCloudProgress();
  if (fetched) {
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
  String url = String(SUPABASE_URL) + "/functions/v1/node-telemetry/baselines?mac_address=" + String(mac);
  String js;
  const bool fetched = cloudGetJson(url.c_str(), js);
  noteCloudProgress();
  if (!fetched) {
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
//   - saved Wi-Fi is tried first; if unavailable, one WiFiManager setup portal
//     opens as ExcaVision-Setup-XXXXXX;
//   - connection/setup retries without blocking sampling or RS-485;
//   - a runtime AP drop is detected (WiFi.status) and reconnected;
//   - if the box stops being the gateway (long-press off), WiFi and the setup
//     AP stop, and the task idles until promotion again.
// ---------------------------------------------------------------------------
static void cloudTask(void*) {
  unsigned long lastConfig = millis();
  unsigned long lastIdleLog = millis();

  ReadingMsg batch[SENDER_MAX_QUEUE];
  int count = 0;
  unsigned long batchStart = millis();

  for (;;) {
    // Role + link lifecycle (our own core — never the main loop).
    if (!isThisGateway()) {
      // This also closes a setup portal if the Gateway role is disabled
      // while setup is in progress. Slaves never enter the WiFi lifecycle.
      cloudStop();
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    if (!cloudConnected()) {
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

    // Drain readings into a batch. Flush as soon as nothing is left to
    // coalesce: holding the batch for the full window added up to
    // SENDER_BATCH_MS of visible lag to every reading.
    ReadingMsg r;
    bool queueIdle = false;
    while (count < SENDER_MAX_QUEUE) {
      if (xQueueReceive(readingQueue, &r, pdMS_TO_TICKS(50)) != pdTRUE) { queueIdle = true; break; }
      batch[count++] = r;
      if (millis() - batchStart >= SENDER_BATCH_MS) break;   // burst window elapsed
    }

    if (count > 0 && (queueIdle || count >= SENDER_MAX_QUEUE || millis() - batchStart >= SENDER_BATCH_MS)) {
      if (!postBatch(batch, count)) {
        // Never silently lose readings: put them back at the front for the next
        // pass. If the queue cannot take them all, the drop is logged.
        int restored = 0;
        for (int i = count - 1; i >= 0; i--) {
          if (xQueueSendToFront(readingQueue, &batch[i], 0) == pdTRUE) restored++;
        }
        Serial.print("[cloud] re-queued "); Serial.print(restored);
        Serial.print("/"); Serial.print(count); Serial.println(" readings after a failed POST");
        vTaskDelay(pdMS_TO_TICKS(1000));   // brief backoff before retrying
      }
      count = 0;
      batchStart = millis();
    }

    // Re-poll the threshold occasionally.
    if (millis() - lastConfig >= CONFIG_POLL_MS) {
      lastConfig = millis();
      fetchThreshold();
    }

    // Liveness line: distinguishes "connected and quiet" from "stalled".
    if (millis() - lastIdleLog >= SENDER_IDLE_LOG_MS) {
      lastIdleLog = millis();
      Serial.print("[cloud] alive — queue="); Serial.print(uxQueueMessagesWaiting(readingQueue));
      Serial.print(" dropped="); Serial.print(droppedReadings);
      Serial.print(" lastProgress="); Serial.print((millis() - lastCloudProgressMs) / 1000);
      Serial.println("s ago");
    }

    taskYIELD();
  }
}

// ---------------------------------------------------------------------------
// Public API (main-loop side — non-blocking, microseconds).
// ---------------------------------------------------------------------------

// Called from the main loop (core 1). Recovers a cloud task that stopped making
// progress — the ESP32 TLS stack can block indefinitely on a half-open socket,
// which no timeout inside that task can escape because the task never returns.
void senderWatchdog() {
  if (!isThisGateway() || cloudPortalActive()) return;
  const uint32_t now = millis();
  if (lastCloudProgressMs == 0 || now - lastCloudProgressMs < SENDER_STALL_MS) return;
  if (lastStallRecoveryMs != 0 && now - lastStallRecoveryMs < SENDER_STALL_MS) return;
  lastStallRecoveryMs = now;
  Serial.print("[cloud] stalled for ");
  Serial.print((now - lastCloudProgressMs) / 1000);
  Serial.print(" s — resetting WiFi+TLS (dropped so far: ");
  Serial.print(droppedReadings);
  Serial.println(")");
  cloudForceReconnect();
  lastCloudProgressMs = now;   // give the reconnect a full window before the next reset
}

void senderInit() {
  if (cloudHandle) return;   // idempotent — only start the task once
  readingQueue = xQueueCreate(SENDER_MAX_QUEUE * 2, sizeof(ReadingMsg));
  eventQueue   = xQueueCreate(32, sizeof(EventMsg));   // 32 slots for alerts/baselines (was 16)
  xTaskCreatePinnedToCore(cloudTask, "cloud", 10240, NULL, 1, &cloudHandle, 0);
}

void senderAddReading(const char* mac, uint8_t channel, float tilt, float g,
                      float temp, uint32_t n, uint32_t fail, bool alertFlag) {
  if (!readingQueue) return;

  // Upload policy: send the moment the tilt moved, otherwise send the latest
  // value on a heartbeat. Alerts bypass the policy entirely.
  UploadTrack* slot = nullptr;
  for (uint8_t i = 0; i < uploadTrackCount; i++) {
    if (uploadTrack[i].channel == channel && strcmp(uploadTrack[i].mac, mac) == 0) {
      slot = &uploadTrack[i];
      break;
    }
  }
  if (!slot && uploadTrackCount < SENDER_TRACK_MAX) {
    slot = &uploadTrack[uploadTrackCount++];
    strncpy(slot->mac, mac, sizeof slot->mac - 1);
    slot->mac[sizeof slot->mac - 1] = '\0';
    slot->channel = channel;
    slot->tilt = 0.0f;
    slot->sentAt = 0;   // 0 also means "never sent", so the first reading goes out
  }
  const bool moved = slot && slot->sentAt != 0
    && fabsf(tilt - slot->tilt) >= SENDER_UPLOAD_DELTA_DEG
    && (millis() - slot->sentAt) >= SENDER_UPLOAD_GAP_MS;
  const bool due = !slot
    || slot->sentAt == 0
    || alertFlag
    || moved
    || (millis() - slot->sentAt) >= SENDER_UPLOAD_HEARTBEAT_MS;
  if (!due) return;
  if (slot) {
    slot->tilt = tilt;
    slot->sentAt = millis();
  }

  ReadingMsg r;
  strncpy(r.mac, mac, sizeof r.mac - 1);
  r.mac[sizeof r.mac - 1] = '\0';
  r.channel = channel; r.tilt = tilt; r.g = g; r.temp = temp;
  r.n = n; r.fail = fail; r.alert = alertFlag;
  xQueueSendToBack(readingQueue, &r, 0);   // drop if full — never block the loop
  if (uxQueueMessagesWaiting(readingQueue) >= SENDER_MAX_QUEUE * 2) droppedReadings++;
}

void senderPushAlert(const char* mac, uint8_t channel, float value) {
  if (!eventQueue) return;
  EventMsg ev;
  memset(&ev, 0, sizeof ev);
  ev.kind = 0;
  strncpy(ev.mac, mac, sizeof ev.mac - 1);
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