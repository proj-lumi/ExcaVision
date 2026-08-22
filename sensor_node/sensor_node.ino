// sensor_node — N-sensor tiltmeter (TCA9548A multiplexed, v2).
//
// Up to 4 MPU6050s on one TCA9548A (at 0x70). Each sensor has its OWN baseline
// and tilt. Sampling is 100 Hz per sensor, averaged over a 1 s window (bench),
// reported once per second as a TABLE — one row per report, each sensor a column.
// 'z' (or a short button press) starts a BASELINE_COLLECT_SECONDS collection; each
// sensor's baseline is the average of those samples (duration configurable).
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

// --- Field interface (Step 1): external button + LED ---
#define BUTTON_PIN 16        // external momentary button (INPUT_PULLUP: HIGH=open, LOW=pressed)
#define LED_PIN    23        // external LED (anode -> 220R -> GND)
#define SHORT_PRESS_MS 1000  // < 1 s = short press = set baseline
#define BASELINE_COLLECT_SECONDS 30  // how long the press collects before zeroing (configurable)

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
  { "S2", 5 },
  { "S3", 3 },
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
  int32_t  sumX = 0, sumY = 0, sumZ = 0;   // int32 = exact sum (no float drift)
  uint32_t sampleCount = 0;
  uint32_t failCount   = 0;
  // Baseline collection sums — SEPARATE from the report window above and NOT
  // reset each report; they span the full BASELINE_COLLECT_SECONDS window.
  int32_t  bsumX = 0, bsumY = 0, bsumZ = 0;
  uint32_t bcount = 0;
  float    bx = 0, by = 0, bz = 0;         // this sensor's baseline (unit vector)
  bool     hasBaseline = false;
};
SensorNode nodes[NUM_SENSORS];

// Non-blocking timers + table row counter
unsigned long lastSample = 0;
unsigned long lastReport = 0;
uint16_t      rowCount   = 0;

// Button debounce + edge detection state (Step 1)
bool          btnLastRaw    = HIGH; // last raw pin reading
bool          btnStable     = HIGH; // debounced (trusted) reading
unsigned long btnLastChange = 0;    // when the raw pin last changed
unsigned long pressStart    = 0;    // when the press began

// LED state machine (Step 2)
enum LedState {
  LED_OFF,          // no baseline loaded — press the button
  LED_FAST_BLINK,   // baseline capture in progress
  LED_SOLID,        // baseline loaded, monitoring normally
  LED_HEARTBEAT,    // baseline loaded AND this box is the gateway (Step 4)
};
LedState ledState = LED_OFF;

// Set by Step 4's long-press (gateway). Default false; when true, LED shows
// the heartbeat instead of plain solid.
bool isGateway = false;

// Baseline collection state: 'z' / a short press starts a collection window.
// Samples feed separate per-sensor accumulators, averaged at the end.
bool          baselineCollecting = false;
unsigned long baselineCollectStart = 0;

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
// Field interface (Step 1): button + LED
// ---------------------------------------------------------------------------

// Starts a baseline collection period on all present sensors. Called by
// serial 'z' AND by a short button press — one action, two input methods.
// Samples accumulate for BASELINE_COLLECT_SECONDS, then are averaged into
// each sensor's baseline. The LED fast-blinks during collection.
void startBaselineCapture() {
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (nodes[i].present) {
      nodes[i].bsumX = nodes[i].bsumY = nodes[i].bsumZ = 0;
      nodes[i].bcount = 0;
    }
  }
  baselineCollecting = true;
  baselineCollectStart = millis();
  Serial.print("collecting baseline for ");
  Serial.print(BASELINE_COLLECT_SECONDS);
  Serial.println(" s (LED fast-blinks during collection)...");
}

// Called when the collection period elapses: average each sensor's
// accumulated samples into its baseline unit vector.
void finalizeBaselineCapture() {
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (!nodes[i].present || nodes[i].bcount == 0) continue;
    float gx = (float)nodes[i].bsumX / nodes[i].bcount / COUNTS_PER_G;
    float gy = (float)nodes[i].bsumY / nodes[i].bcount / COUNTS_PER_G;
    float gz = (float)nodes[i].bsumZ / nodes[i].bcount / COUNTS_PER_G;
    float mag = sqrt(gx*gx + gy*gy + gz*gz);
    nodes[i].bx = gx/mag;  nodes[i].by = gy/mag;  nodes[i].bz = gz/mag;
    nodes[i].hasBaseline = true;
    Serial.print("baseline "); Serial.print(SENSORS[i].name);
    Serial.print(" set: (");
    Serial.print(nodes[i].bx, 4); Serial.print(", ");
    Serial.print(nodes[i].by, 4); Serial.print(", ");
    Serial.print(nodes[i].bz, 4);
    Serial.print(") — averaged over "); Serial.print(nodes[i].bcount);
    Serial.println(" samples");
  }
  baselineCollecting = false;
}

// Derive the LED state from the node states. Called every loop() so it stays
// in sync with baseline/zero changes.
void recomputeLedState() {
  uint8_t presentCount  = 0;
  bool    allHaveBase   = true;
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (!nodes[i].present) continue;
    presentCount++;
    if (!nodes[i].hasBaseline) allHaveBase = false;
  }

  if (baselineCollecting) {
    ledState = LED_FAST_BLINK;      // busy capturing a baseline
  } else if (presentCount == 0 || !allHaveBase) {
    ledState = LED_OFF;             // no sensors, or some still need a baseline
  } else {
    ledState = isGateway ? LED_HEARTBEAT : LED_SOLID;
  }
}

// Non-blocking LED driver, called every loop(). Each state is just "is the
// LED on at this millisecond?" — pure time math, no stored toggle state.
void updateLed() {
  unsigned long now = millis();
  bool on = false;
  switch (ledState) {
    case LED_OFF:        on = false;                          break;
    case LED_SOLID:      on = true;                           break;
    case LED_FAST_BLINK: on = (now % 200)  < 100;             break; // ~5 Hz
    case LED_HEARTBEAT:  on = (now % 2000) < 1900;            break; // solid w/ dip
  }
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

// Call every loop(). Debounces the button and detects press/release edges.
void pollButton() {
  bool raw = digitalRead(BUTTON_PIN);
  // Any change in the raw pin resets the debounce timer.
  if (raw != btnLastRaw) {
    btnLastRaw = raw;
    btnLastChange = millis();
  }

  // Only after the pin has been stable for 30 ms do we trust the change.
  if ((millis() - btnLastChange) >= 30 && raw != btnStable) {
    btnStable = raw;   // a real, debounced edge happened

    if (btnStable == LOW) {
      // Press started — remember when.
      pressStart = millis();
    } else {
      // Released — how long was it held?
      unsigned long held = millis() - pressStart;
      if (held < SHORT_PRESS_MS) {
        startBaselineCapture();   // SHORT press -> collect baseline for 30 s
      }
      // (long-press -> gateway comes in Step 4; for now longer holds do nothing)
    }
  }
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

  // Field interface (Step 1)
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // button: HIGH when open, LOW when pressed
  pinMode(LED_PIN, OUTPUT);           // LED (Step 2 will drive its states; ready now)
  digitalWrite(LED_PIN, LOW);         // start off
}

// ---------------------------------------------------------------------------
// loop() — three blocks, each iterating the sensor array. No delay() anywhere:
// every block checks millis() and only acts when due, so the CPU stays free.
// ---------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  pollButton();      // field interface: button edge detection
  updateLed();       // drive the LED for the current state

  // ── Sample block: every 10 ms, read each present sensor and accumulate ──
  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;
    for (uint8_t i = 0; i < NUM_SENSORS; i++) {
      if (!nodes[i].present) continue;
      int16_t ax, ay, az;
      if (nodes[i].mpu.readAccel(ax, ay, az)) {
        nodes[i].sumX += ax;  nodes[i].sumY += ay;  nodes[i].sumZ += az;
        nodes[i].sampleCount++;
        if (baselineCollecting) {   // also feed the baseline accumulators
          nodes[i].bsumX += ax;  nodes[i].bsumY += ay;  nodes[i].bsumZ += az;
          nodes[i].bcount++;
        }
      } else {
        nodes[i].failCount++;            // bus drop; n will be < 100 in the report
      }
    }
  }

  // ── Serial zero command: 'z' starts baseline collection (same as the button) ──
  if (Serial.available() && Serial.read() == 'z') {
    startBaselineCapture();
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

  // Baseline collection completion: after BASELINE_COLLECT_SECONDS, average
  // the accumulated samples and set each sensor's baseline.
  if (baselineCollecting && (now - baselineCollectStart) >= BASELINE_COLLECT_SECONDS * 1000UL) {
    finalizeBaselineCapture();
  }

  recomputeLedState();   // keep the LED in sync (baselines may have just applied)
}
