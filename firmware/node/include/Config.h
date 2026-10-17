#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#include "MPU6050.h"

// ---------------------------------------------------------------------------
// Tuning constants — change these to adjust behavior.
// ---------------------------------------------------------------------------

// --- Sampling & reporting ---
#define SAMPLE_INTERVAL_MS   10          // 10 ms = 100 Hz sampling per sensor
#define REPORT_INTERVAL_MS   1000        // 1 s = report once per second (bench mode)
#define COUNTS_PER_G         16384.0     // accelerometer sensitivity at ±2 g

// --- Report table layout (fixed-width fields keep columns aligned) ---
#define TIME_W    7   // "  time " column width
#define BLOCK_W  28   // per-sensor block width: " tilt   |g|    T   n/fail "
#define HEADER_EVERY 20   // reprint the header every N rows so it stays visible

// --- Field interface ---
#define BUTTON_PIN 16         // external momentary button (INPUT_PULLUP)
#define LED_PIN 23            // external LED (anode -> 220R -> GND)
#define SHORT_PRESS_MS 1500   // short press captures a baseline; leaves room for a normal click
#define GATEWAY_HOLD_MS 3000  // long press selects/deselects the Gateway role
#define FULL_TEST_RESET_HOLD_MS 10000   // 10 s hold resets all local state

// Threshold alarm
#define BUZZER_PIN 17        // piezo buzzer (spec: suggested GPIO 17 or 18)
#define THRESHOLD_DEG 2.0    // default alert threshold; gateway/cloud sync can override
#define ALARM_HYSTERESIS_DEG 0.5   // release only after tilt drops below (threshold - this): stops chattering at the line
#define ALARM_HOLD_SECONDS  3      // tilt must STAY above threshold this many seconds before the alarm trips: debounces single-sample spikes
#define ALARM_BEEP_MS 250    // buzzer beep duration
#define ALARM_GAP_MS  250    // buzzer gap between beeps
#define BASELINE_COLLECT_SECONDS 30  // how long the press collects before zeroing (configurable)

// RS-485 transport
#define RS485_TX_PIN 33         // DI — ESP32 UART TX to the transceiver
#define RS485_RX_PIN 34         // RO — transceiver output to ESP32 UART RX (input-only GPIO)
#define RS485_DE_PIN 32         // direction: HIGH = transmit, LOW = receive
#define RS485_BAUD  115200UL
#define RS485_POLL_MS      1000UL  // master polls one slave per second
#define RS485_RESP_TIMEOUT_MS 120UL  // master waits this long for a reply
#define RS485_DISCOVER_MS  3000UL // 256 × 10 ms discovery slots
#define RS485_DISCOVERY_SLOT_MS 10UL
#define RS485_BASELINE_SLOT_MS 25UL // separate simultaneous slave B replies
#define RS485_REDISCOVER_MS 30000UL // find nodes added/restarted after boot
#define RS485_MAX_SLAVES   16
#define RS485_MAX_LINE     256
#define RS485_RX_BUDGET    256   // max UART bytes handled per loop; bounds noisy/floating RO work

// Cloud transport
// Upload policy: a reading is sent immediately when the tilt moves, and the
// latest value is re-sent as a heartbeat otherwise. Pushing every 1 Hz reading
// saturated the TLS path and delayed the readings that mattered.
#define SENDER_UPLOAD_DELTA_DEG    0.20f      // immediate upload when tilt changes by this much
#define SENDER_UPLOAD_GAP_MS       1000UL     // floor between two immediate uploads per channel
#define SENDER_UPLOAD_HEARTBEAT_MS 15000UL    // otherwise upload the latest value this often
#define SENDER_STALL_MS            120000UL   // no completed request this long -> recover the link
#define SENDER_BATCH_MS   5000UL    // coalesce a burst for at most this long
#define SENDER_BATCH_RETRIES 2      // a failed batch is re-queued, then retried once more
#define SENDER_MAX_QUEUE  20        // keep batch bodies ~2 KB (large POSTs can truncate over TLS)
#define SENDER_TRACK_MAX  48        // mac+channel slots remembered for the upload policy
#define SENDER_IDLE_LOG_MS 30000UL  // cloud-task liveness line (queue depth / drops / last success)
#define CONFIG_POLL_MS    15000UL   // re-fetch the threshold every 15 s (keeps the app's realtime control tight)
#define BASELINE_RECOVERY_INTERVAL_MS 5000UL  // NVS-empty slave asks the master for cloud baselines this often
#define BASELINE_RECOVERY_ATTEMPTS    5       // stop after ~25 s if the master never answers
#define BASELINE_UPLOAD_RETRIES       3       // alert/baseline POSTs retry this many times on timeout/failure (never silently lose them)

// ---------------------------------------------------------------------------
// Sensor definition table — the scalability knob.
// Each entry: { name, TCA channel }. Add a line to add a sensor.
// ---------------------------------------------------------------------------
struct SensorDef {
  const char* name;
  uint8_t channel;
};

// PRODUCTION SENSOR MAP:
//   S1 = channel 7, S2 = channel 3, S3 = channel 5, S4 = channel 1
const SensorDef SENSORS[] = {
  { "S1", 7 },
  { "S2", 3 },
  { "S3", 5 },
  { "S4", 1 },
};
const uint8_t NUM_SENSORS = sizeof(SENSORS) / sizeof(SENSORS[0]);

// ---------------------------------------------------------------------------
// Per-sensor runtime state (parallel to SENSORS[]).
// Each sensor keeps its own accumulators and its own baseline, so they're
// fully independent — zeroing or losing one never affects another.
// ---------------------------------------------------------------------------
struct SensorNode {
  MPU6050 mpu;                   // owns this sensor's TCA channel
  bool     present      = false; // set by the boot scan; missing sensors are skipped
  int32_t  sumX = 0, sumY = 0, sumZ = 0;   // 1 s report-window sums (reset each report)
  uint32_t sampleCount = 0;
  uint32_t failCount   = 0;
  // Baseline collection sums — SEPARATE from the report window above and NOT
  // reset each report; they span the full BASELINE_COLLECT_SECONDS window.
  int32_t  bsumX = 0, bsumY = 0, bsumZ = 0;
  uint32_t bcount = 0;
  float    bx = 0, by = 0, bz = 0;         // this sensor's baseline (unit vector)
  bool     hasBaseline = false;
  // Latest computed reading, refreshed by Report each cycle — this is what the
  // RS-485 slave answers a poll with (and what a future stream would send).
  float    lastTilt = 0;
  float    lastMag  = 0;
  float    lastTemp = 0;
  uint32_t lastN    = 0;
  uint32_t lastFail = 0;
};

extern SensorNode nodes[];   // defined in main.cpp

#endif
