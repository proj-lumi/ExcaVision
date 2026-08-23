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

// --- Field interface: external button + LED ---
#define BUTTON_PIN 16        // external momentary button (INPUT_PULLUP: HIGH=open, LOW=pressed)
#define LED_PIN    23        // external LED (anode -> 220R -> GND)
#define SHORT_PRESS_MS 1000  // < 1 s = short press = set baseline
#define GATEWAY_HOLD_MS 3000  // hold >= 3 s = long press = set gateway

// --- Threshold alarm (Step 7) ---
#define BUZZER_PIN 17        // piezo buzzer (spec: suggested GPIO 17 or 18)
#define THRESHOLD_DEG 2.0    // default alert threshold; engineer sets per pipe later (serial 't' overrides)
#define ALARM_BEEP_MS 250    // buzzer beep duration
#define ALARM_GAP_MS  250    // buzzer gap between beeps
#define BASELINE_COLLECT_SECONDS 30  // how long the press collects before zeroing (configurable)

// --- RS-485 transport (feat/transport Phase A) ---
#define RS485_TX_PIN 33         // DI — ESP32 UART TX to the transceiver
#define RS485_RX_PIN 18         // RO — transceiver output to ESP32 UART RX
#define RS485_DE_PIN 25         // direction: HIGH = transmit, LOW = receive
#define RS485_BAUD  115200UL
#define RS485_POLL_MS      1000UL  // master polls one slave per second
#define RS485_RESP_TIMEOUT_MS 120UL  // master waits this long for a reply
#define RS485_DISCOVER_MS  800UL  // discovery window for slave hellos
#define RS485_MAX_SLAVES   16
#define RS485_MAX_LINE     256

// ---------------------------------------------------------------------------
// Sensor definition table — the scalability knob.
// Each entry: { name, TCA channel }. Add a line to add a sensor.
// ---------------------------------------------------------------------------
struct SensorDef {
  const char* name;
  uint8_t channel;
};

const SensorDef SENSORS[] = {
  { "S1", 7 },   // right, near  (0.5 m)
  { "S2", 3 },   // left,  near  (0.5 m)
  { "S3", 5 },   // right, far   (1.0 m)
  { "S4", 1 },   // left,  far   (1.0 m)
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

extern SensorNode nodes[];   // defined in sensor_node.ino

#endif
