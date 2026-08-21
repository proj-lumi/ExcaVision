// sensor_node - continuous tiltmeter (v1) — see SPEC.md for the full spec.
// Sampling happens at 100 Hz into 1-second averaging windows. Once a second
// it reports: tilt in degrees from the install-time baseline (set with 'z'),
// the |g| health check, die temperature, and sample/fail counts.
//
// Two ideas that make this accurate, explained simply:
//  - Averaging 100 samples kills ~sqrt(100)=10x of the sensor noise, so a
//    slow shoring movement of 0.01-0.05 degrees becomes visible.
//  (For deployment, widen REPORT_INTERVAL_MS back to 60000: 6000 samples
//   per report = ~77x noise reduction, far fewer DB rows, lower radio use.)
//  - Tilt is the ANGLE between gravity's direction now and its direction at
//    install. atan2(|cross|, dot) is numerically safe for tiny angles
//    (acos is not), and it works no matter how the sensor was mounted.

#include <math.h>
#include "MPU6050.h"

// --- Tuning ---
#define SAMPLE_INTERVAL_MS   10          // 10 ms = 100 Hz sampling
#define REPORT_INTERVAL_MS   1000        // 1 s = report once per second (bench mode)
#define COUNTS_PER_G         16384.0     // accelerometer sensitivity at ±2 g

MPU6050 mpu;

// ---------------------------------------------------------------------------
// State (all in RAM — lost on reboot, by design for v1)
// ---------------------------------------------------------------------------

// Non-blocking timers
unsigned long lastSample = 0;
unsigned long lastReport = 0;

// Accumulators for the current report window.
// int32_t is EXACT here: even at 1 s the window holds ~100 samples each up
// to ~32768, and at 60 s it holds ~6000. A float would lose precision in
// that sum, so we only convert to float at report time (mean = sum / count).
int32_t  sumX = 0, sumY = 0, sumZ = 0;
uint32_t sampleCount = 0;
uint32_t failCount   = 0;

// Install-time baseline gravity direction (normalized unit vector).
// RAM-only in v1: a reboot loses it, and you must deliberately re-zero.
// Persisting it to flash is the immediate next step after v1.
float   bx = 0, by = 0, bz = 0;
bool    hasBaseline = false;

// 'z' doesn't zero instantly — it arms this flag, and the NEXT full report
// window supplies the averaged gravity vector as the baseline. This avoids
// a race with the report block resetting the accumulator each cycle (at 1 s
// reports, sampleCount is only >= 100 for a fleeting instant, so instant
// zeroing was nearly impossible to trigger by hand).
bool    zeroPending = false;

// ---------------------------------------------------------------------------
// setup()
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  mpu.begin(21, 22);   // SDA 21, SCL 22, addr 0x68 is handled inside the class
  Serial.println("MPU6050 ready. Send 'z' to set baseline (applies on next report).");
}

// ---------------------------------------------------------------------------
// loop() — two timed blocks (sample / report) + serial zero check.
// No delay() anywhere: every block checks millis() and only acts when due,
// so the CPU stays free between 10 ms samples.
// ---------------------------------------------------------------------------

void loop() {
  unsigned long now = millis();

  // ── Sample block: every 10 ms, read and accumulate ──
  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;
    int16_t ax, ay, az;
    if (mpu.readAccel(ax, ay, az)) {
      sumX += ax;  sumY += ay;  sumZ += az;
      sampleCount++;
    } else {
      failCount++;            // bus drop; n will be < 100 in the report
    }
  }

  // ── Serial zero command: 'z' arms a baseline capture ──
  // We don't zero instantly. We set a flag and let the NEXT full report
  // window supply the averaged gravity vector. That guarantees the baseline
  // is built from a complete, clean window (100 samples at 1 s, 6000 at 60 s)
  // no matter when during the cycle you typed 'z'.
  if (Serial.available() && Serial.read() == 'z') {
    zeroPending = true;
    Serial.println("zero pending — baseline will be set on next report");
  }

  // ── Report block: every 1 s, average, compute tilt, print ──
  if (now - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = now;
    if (sampleCount == 0) {       // e.g. every read failed this minute
      Serial.println("[1s] no samples collected");
      return;
    }

    // mean raw counts → g
    float gx = (float)sumX / sampleCount / COUNTS_PER_G;
    float gy = (float)sumY / sampleCount / COUNTS_PER_G;
    float gz = (float)sumZ / sampleCount / COUNTS_PER_G;
    float mag = sqrt(gx*gx + gy*gy + gz*gz);   // |g|, should be ≈ 1.000
    float tempC = mpu.readTemperatureC();

    // If a zero was requested, capture THIS window's averaged gravity as the
    // baseline (a full window = a clean reference). Doing it here means the
    // same report immediately reads tilt ≈ 0.000° as confirmation.
    if (zeroPending) {
      bx = gx/mag;  by = gy/mag;  bz = gz/mag;
      hasBaseline = true;
      zeroPending = false;
      Serial.print("baseline set: (");
      Serial.print(bx,4); Serial.print(", "); Serial.print(by,4);
      Serial.print(", "); Serial.print(bz,4); Serial.println(") — tilt zeroed");
    }

    Serial.print("[1s] ");

    if (hasBaseline) {
      // Tilt = angle between current and baseline gravity directions.
      // Use atan2(|cross|, dot) — numerically safe for the small angles
      // we care about (unlike acos, which is sick near 0°).
      float ux = gx/mag, uy = gy/mag, uz = gz/mag;   // current unit vector
      float dot = ux*bx + uy*by + uz*bz;
      float cx  = uy*bz - uz*by;                      // current × baseline
      float cy  = uz*bx - ux*bz;
      float cz  = ux*by - uy*bx;
      float crossMag = sqrt(cx*cx + cy*cy + cz*cz);
      float tiltDeg = atan2(crossMag, dot) * 180.0 / PI;
      Serial.print("tilt = ");  Serial.print(tiltDeg, 3); Serial.print("°   ");
    } else {
      Serial.print("tilt = --   ");   // no baseline yet
    }

    Serial.print("|g| = ");   Serial.print(mag, 3); Serial.print(" g   ");
    Serial.print("T = ");     Serial.print(tempC, 1); Serial.print(" °C   ");
    Serial.print("(n=");      Serial.print(sampleCount);
    Serial.print(", fail=");  Serial.print(failCount); Serial.println(")");

    // reset window for the next minute
    sumX=sumY=sumZ=0; sampleCount=0; failCount=0;
  }
}