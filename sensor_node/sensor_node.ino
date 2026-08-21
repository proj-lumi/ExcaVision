// sensor_node — N-sensor tiltmeter (TCA9548A multiplexed, v2).
//
// Up to 4 MPU6050s on one TCA9548A (at 0x70). Each sensor has its OWN baseline
// and tilt. Sampling is 100 Hz per sensor, averaged over a 1 s window (bench),
// reported once per second as a TABLE — one row per report, each sensor a column.
// 'z' over serial zeroes ALL sensors' baselines (each captures on its next full
// report window).
//
// ── Adding a sensor: add a line to the SENSORS[] table below. That's it. ──
// The sample/report/zero loops iterate the array automatically.
//
// Two accuracy ideas, briefly:
//  - Averaging ~100 samples per second kills ~10x of sensor noise.
//  - Tilt = the angle between gravity-now and gravity-at-install, via
//    atan2(|cross|, dot) — mounting-independent and safe for tiny angles
//    (acos is not), so it works no matter how each sensor is mounted.
//
// v1 limitations still apply: baselines are RAM-only (a reboot loses them all;
// flash persistence is the next step), no WiFi/Supabase/sleep/alarm logic.

#include <stdio.h>   // snprintf
#include <Wire.h>
#include <math.h>
#include "MPU6050.h"

// --- Tuning ---
#define SAMPLE_INTERVAL_MS   10          // 10 ms = 100 Hz sampling per sensor
#define REPORT_INTERVAL_MS   1000        // 1 s = report once per second (bench mode)
#define COUNTS_PER_G         16384.0     // accelerometer sensitivity at ±2 g

// --- Report table layout (fixed-width fields keep columns aligned) ---
#define TIME_W    7   // "  time " column width
#define BLOCK_W  28   // per-sensor block width: " tilt   |g|    T   n/fail "
#define HEADER_EVERY 20   // reprint the header every N rows so it stays visible

// ---------------------------------------------------------------------------
// Sensor definition table — the scalability knob.
// Each entry: { name, TCA channel }. Add a line to add a sensor.
// ---------------------------------------------------------------------------
struct SensorDef {
  const char* name;
  uint8_t channel;
};

const SensorDef SENSORS[] = {
  { "S1", 7 },
  { "S2", 3 },
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
  int32_t  sumX = 0, sumY = 0, sumZ = 0;   // int32 = exact sum (no float drift)
  uint32_t sampleCount = 0;
  uint32_t failCount   = 0;
  float    bx = 0, by = 0, bz = 0;         // this sensor's baseline (unit vector)
  bool     hasBaseline = false;
  bool     zeroPending = false;            // armed by 'z', applied on next report
};
SensorNode nodes[NUM_SENSORS];

// Non-blocking timers + table row counter
unsigned long lastSample = 0;
unsigned long lastReport = 0;
uint16_t      rowCount   = 0;

// ---------------------------------------------------------------------------
// Report table helpers
// ---------------------------------------------------------------------------

// Center a string in a fixed width (for the header's sensor-name row).
static void printCentered(const char* s, uint8_t w) {
  uint8_t len = strlen(s);
  if (len >= w) { Serial.print(s); return; }
  uint16_t pad = w - len;
  for (uint16_t i = 0; i < pad / 2; i++) Serial.print(' ');
  Serial.print(s);
  for (uint16_t i = 0; i < pad - pad / 2; i++) Serial.print(' ');
}

// Print the 3-line table header (names, labels, separator). Scales with N.
static void printReportHeader() {
  // names row
  printCentered("time", TIME_W);
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    Serial.print('|');
    printCentered(SENSORS[i].name, BLOCK_W);
  }
  Serial.println();
  // labels row — field widths match the data block exactly so columns align
  Serial.print("  (s)  ");                // TIME_W wide, aligned with the time dashes above
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    Serial.print('|');
    char lab[40];
    snprintf(lab, sizeof(lab), " %6s %5s %5s %8s", "tilt", "|g|", "T", "n/fail");
    Serial.print(lab);
  }
  Serial.println();
  // separator row
  for (uint8_t i = 0; i < TIME_W; i++) Serial.print('-');
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    Serial.print('+');
    for (uint8_t j = 0; j < BLOCK_W; j++) Serial.print('-');
  }
  Serial.println();
}

// ---------------------------------------------------------------------------
// setup() — init bus, scan for sensors, wake the ones that answered.
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);              // SDA 21, SCL 22 — called ONCE here
  delay(500);

  Serial.print("Scanning ");
  Serial.print(NUM_SENSORS);
  Serial.println(" sensors...");
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    nodes[i].mpu.begin(SENSORS[i].channel);   // store channel + select + wake
    nodes[i].present = nodes[i].mpu.probe(); // ACK check at the MPU address
    Serial.print(SENSORS[i].name);
    Serial.print(" (ch");
    Serial.print(SENSORS[i].channel);
    Serial.print("): ");
    Serial.println(nodes[i].present ? "present" : "MISSING");
  }

  Serial.println("MPU6050 ready. Send 'z' to set baseline (applies on next report).");
}

// ---------------------------------------------------------------------------
// loop() — three blocks, each iterating the sensor array. No delay() anywhere:
// every block checks millis() and only acts when due, so the CPU stays free.
// ---------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  // ── Sample block: every 10 ms, read each present sensor and accumulate ──
  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      if (!nodes[i].present) continue;
      int16_t ax, ay, az;
      if (nodes[i].mpu.readAccel(ax, ay, az)) {
        nodes[i].sumX += ax;  nodes[i].sumY += ay;  nodes[i].sumZ += az;
        nodes[i].sampleCount++;
      } else {
        nodes[i].failCount++;            // bus drop; n will be < 100 in the report
      }
    }
  }

  // ── Serial zero command: 'z' arms baseline capture on ALL sensors ──
  if (Serial.available() && Serial.read() == 'z') {
    for (uint8_t i = 0; i < NUM_SENSORS; i++)
      if (nodes[i].present) nodes[i].zeroPending = true;
    Serial.println("zero pending — all sensors baseline on next report");
  }

  // ── Report block: every 1 s → one TABLE ROW, sensors as columns ──
  if (now - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = now;

    // Precompute each sensor's fixed-width block string.
    char blocks[NUM_SENSORS][40];
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      if (!nodes[i].present || nodes[i].sampleCount == 0) {
        // No data this window: keep the column aligned with -- placeholders,
        // but still show the fail count so bus drops are visible.
        snprintf(blocks[i], sizeof(blocks[i]),
                 " %6s %5s %5s %4d/%-3d", "--", "--", "--", 0, nodes[i].failCount);
        // reset window even on the empty case
        nodes[i].sumX = nodes[i].sumY = nodes[i].sumZ = 0;
        nodes[i].sampleCount = 0;
        nodes[i].failCount   = 0;
        continue;
      }

      // mean raw counts → g
      float gx = (float)nodes[i].sumX / nodes[i].sampleCount / COUNTS_PER_G;
      float gy = (float)nodes[i].sumY / nodes[i].sampleCount / COUNTS_PER_G;
      float gz = (float)nodes[i].sumZ / nodes[i].sampleCount / COUNTS_PER_G;
      float mag = sqrt(gx*gx + gy*gy + gz*gz);   // |g|, should be ≈ 1.000
      float tempC = nodes[i].mpu.readTemperatureC();

      // If a zero was requested, capture THIS window as this sensor's baseline.
      if (nodes[i].zeroPending) {
        nodes[i].bx = gx/mag;  nodes[i].by = gy/mag;  nodes[i].bz = gz/mag;
        nodes[i].hasBaseline = true;
        nodes[i].zeroPending = false;
        Serial.print("baseline "); Serial.print(SENSORS[i].name);
        Serial.print(" set: (");
        Serial.print(nodes[i].bx, 4); Serial.print(", ");
        Serial.print(nodes[i].by, 4); Serial.print(", ");
        Serial.print(nodes[i].bz, 4); Serial.println(") — tilt zeroed");
      }

      // Tilt = angle between current and baseline gravity directions.
      // atan2(|cross|, dot) is numerically safe for the small angles we care
      // about (unlike acos, which is sick near 0°).
      float tiltDeg = 0.0;
      if (nodes[i].hasBaseline) {
        float ux = gx/mag, uy = gy/mag, uz = gz/mag;
        float dot = ux*nodes[i].bx + uy*nodes[i].by + uz*nodes[i].bz;
        float cx  = uy*nodes[i].bz - uz*nodes[i].by;   // current × baseline
        float cy  = uz*nodes[i].bx - ux*nodes[i].bz;
        float cz  = ux*nodes[i].by - uy*nodes[i].bx;
        float crossMag = sqrt(cx*cx + cy*cy + cz*cz);
        tiltDeg = atan2(crossMag, dot) * 180.0 / PI;
        snprintf(blocks[i], sizeof(blocks[i]),
                 " %6.3f %5.3f %5.1f %4d/%-3d",
                 tiltDeg, mag, tempC, nodes[i].sampleCount, nodes[i].failCount);
      } else {
        snprintf(blocks[i], sizeof(blocks[i]),
                 " %6s %5.3f %5.1f %4d/%-3d",
                 "--", mag, tempC, nodes[i].sampleCount, nodes[i].failCount);
      }

      // reset THIS sensor's window for the next minute
      nodes[i].sumX = nodes[i].sumY = nodes[i].sumZ = 0;
      nodes[i].sampleCount = 0;
      nodes[i].failCount   = 0;
    }

    // Reprint the header periodically so it stays visible while scrolling.
    if (rowCount == 0 || rowCount >= HEADER_EVERY) {
      printReportHeader();
      rowCount = 0;
    }
    rowCount++;

    // Print one row: time column + one block per sensor, separated by '|'.
    char timebuf[16];
    snprintf(timebuf, sizeof(timebuf), "%*.*f", TIME_W, 1, (double)(now / 1000.0));
    Serial.print(timebuf);
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      Serial.print('|');
      Serial.print(blocks[i]);
    }
    Serial.println();
  }
}