# Plan: `sensor_node` continuous tiltmeter (v1, RAM baseline)

## Goal

A non-blocking ESP32 + MPU6050 firmware that samples the accelerometer at 100 Hz,
averages a 60-second window, and reports once a minute: **tilt in degrees from an
install-time baseline**, the `|g|` health check, internal temperature, and
sample/fail counts. Baseline is set via a serial `z` command and held in RAM
only (no flash persistence — that's a later step). No WiFi, no Supabase, no
sleep, no Kalman, no alarm logic in v1.

## Validated facts (do NOT deviate)

- **Chip**: reports `WHO_AM_I = 0x70` (MPU-6500 die on a "MPU6050" module).
  Register-compatible with MPU6050 for accel/temp.
- **I2C address**: `0x68` (AD0 tied low).
- **Pins**: SDA = GPIO 21, SCL = GPIO 22.
- **Bus clock**: 100 kHz default (`Wire.begin(21,22)` — do NOT call `setClock`).
- **Read method that works**: **three separate 2-byte register reads** (write reg
  with repeated-start, then `requestFrom(2)`). Do NOT use a 6-byte burst — it
  produced garbage Z values on this board. Do NOT use the Adafruit library —
  its `WHO_AM_I` gate rejects 0x70.
- **Bus is reliable only with WiFi OFF.** v1 has no WiFi; do not add it.
- **Confirmed physical baseline**: at rest, `|g|` ≈ 1.008 g, per-sample noise
  ≈ ±50 counts. The sensor sits with gravity mostly along its X axis (mounting
  detail — the baseline-vector method makes this irrelevant).

## File layout

```
sensor_node/
├── sensor_node.ino     ← rewritten (setup + non-blocking loop + tilt math)
├── MPU6050.h           ← labeled register addresses + class declaration
├── MPU6050.cpp         ← Wire plumbing, wake, reads (static read16 helper)
└── archive/            ← existing, untouched
```

Arduino compiles all `.cpp`/`.h` in the sketch root; `archive/` is not compiled
(non-standard folder name) — leave it.

## `MPU6050.h`

Labeled addresses (no magic hex anywhere else):

```cpp
#ifndef MPU6050_H
#define MPU6050_H

#include <Arduino.h>

// MPU6050 I2C device address (AD0 tied LOW)
#define MPU6050_I2C_ADDR     0x68

// Register addresses (from the MPU6050 datasheet register map)
#define MPU6050_PWR_MGMT_1    0x6B   // Power Management 1 — SLEEP bit lives here
#define MPU6050_ACCEL_XOUT_H  0x3B   // Accelerometer X, high byte
#define MPU6050_ACCEL_YOUT_H  0x3D   // Accelerometer Y, high byte
#define MPU6050_ACCEL_ZOUT_H  0x3F   // Accelerometer Z, high byte
#define MPU6050_TEMP_OUT_H    0x41   // Temperature, high byte

class MPU6050 {
public:
  void begin(uint8_t sda, uint8_t scl);                     // init Wire + wake the chip
  bool readAccel(int16_t &ax, int16_t &ay, int16_t &az);   // three labeled reads
  float readTemperatureC();                                // die temperature in °C
private:
  bool read16(uint8_t reg, int16_t &out);                  // big-endian 2-byte register read
};

#endif
```

## `MPU6050.cpp`

```cpp
#include <Wire.h>
#include "MPU6050.h"

// Read one 16-bit big-endian register. Returns false on I2C failure so a
// failure is distinguishable from a real 0 reading.
bool MPU6050::read16(uint8_t reg, int16_t &out) {
  Wire.beginTransmission(MPU6050_I2C_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  Wire.requestFrom(MPU6050_I2C_ADDR, (uint8_t)2);
  if (Wire.available() < 2) return false;

  int16_t high = Wire.read();
  int16_t low  = Wire.read();
  out = (high << 8) | low;
  return true;
}

void MPU6050::begin(uint8_t sda, uint8_t scl) {
  Wire.begin(sda, scl);
  delay(100);  // let the chip settle

  // Wake the MPU6050: write 0x00 to PWR_MGMT_1 to clear the SLEEP bit.
  Wire.beginTransmission(MPU6050_I2C_ADDR);
  Wire.write(MPU6050_PWR_MGMT_1);
  Wire.write(0x00);
  Wire.endTransmission();
}

bool MPU6050::readAccel(int16_t &ax, int16_t &ay, int16_t &az) {
  bool ok = read16(MPU6050_ACCEL_XOUT_H, ax) &&
            read16(MPU6050_ACCEL_YOUT_H, ay) &&
            read16(MPU6050_ACCEL_ZOUT_H, az);
  return ok;
}

float MPU6050::readTemperatureC() {
  int16_t raw;
  if (!read16(MPU6050_TEMP_OUT_H, raw)) return NAN;  // bus failure
  return (raw / 340.0) + 36.53;  // datasheet conversion
}
```

## `sensor_node.ino`

### Top-of-file constants (tuning knobs, visible to a beginner)

```cpp
#include <math.h>
#include "MPU6050.h"

// --- Tuning ---
#define SAMPLE_INTERVAL_MS   10          // 10 ms = 100 Hz sampling
#define REPORT_INTERVAL_MS   60000       // 60 s = report once per minute
#define COUNTS_PER_G         16384.0     // accelerometer sensitivity at ±2 g
#define ZERO_MIN_SAMPLES     100         // need ~1 s of data before 'z' works

MPU6050 mpu;
```

### State (all in RAM — lost on reboot, by design for v1)

```cpp
// Non-blocking timers
unsigned long lastSample = 0;
unsigned long lastReport = 0;

// Accumulators for the current 60 s window (int32 = exact, no float drift)
int32_t  sumX = 0, sumY = 0, sumZ = 0;
uint32_t sampleCount = 0;
uint32_t failCount   = 0;

// Install-time baseline gravity direction (normalized). RAM-only in v1.
float   bx = 0, by = 0, bz = 0;
bool    hasBaseline = false;
```

### `setup()`

```cpp
void setup() {
  Serial.begin(115200);
  mpu.begin(21, 22);          // SDA 21, SCL 22, addr 0x68 inside the class
  Serial.println("MPU6050 ready. Send 'z' after ~60 s to set baseline.");
}
```

### `loop()` — two timed blocks + serial zero check, no `delay()`

Pseudocode (implement with these exact semantics, comment heavily):

```cpp
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
      failCount++;            // bus drop; n will be < 6000 in the report
    }
  }

  // ── Serial zero command: 'z' sets the baseline ──
  if (Serial.available() && Serial.read() == 'z') {
    if (sampleCount >= ZERO_MIN_SAMPLES) {
      // average current window, normalize, store as baseline
      float gx = (float)sumX / sampleCount / COUNTS_PER_G;
      float gy = (float)sumY / sampleCount / COUNTS_PER_G;
      float gz = (float)sumZ / sampleCount / COUNTS_PER_G;
      float mag = sqrt(gx*gx + gy*gy + gz*gz);
      bx = gx/mag;  by = gy/mag;  bz = gz/mag;
      hasBaseline = true;
      Serial.print("baseline set: (");
      Serial.print(bx,4); Serial.print(", "); Serial.print(by,4);
      Serial.print(", "); Serial.print(bz,4); Serial.println(") — tilt zeroed");
      // reset the window so the next report starts fresh
      sumX=sumY=sumZ=0; sampleCount=0; failCount=0;
    } else {
      Serial.print("collecting (n=");
      Serial.print(sampleCount); Serial.println("), wait before zeroing");
    }
  }

  // ── Report block: every 60 s, average, compute tilt, print ──
  if (now - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = now;
    if (sampleCount == 0) {       // e.g. every read failed this minute
      Serial.println("[60s] no samples collected");
      return;
    }

    // mean raw counts → g
    float gx = (float)sumX / sampleCount / COUNTS_PER_G;
    float gy = (float)sumY / sampleCount / COUNTS_PER_G;
    float gz = (float)sumZ / sampleCount / COUNTS_PER_G;
    float mag = sqrt(gx*gx + gy*gy + gz*gz);   // |g|, should be ≈ 1.000
    float tempC = mpu.readTemperatureC();

    Serial.print("[60s] ");

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
```

## Behavior contract (what the serial output looks like)

```
MPU6050 ready. Send 'z' after ~60 s to set baseline.
[60s] tilt = --   |g| = 1.004 g   T = 24.3 °C   (n=6000, fail=0)
<user sends 'z'>
baseline set: (1.0000, 0.0180, -0.0340) — tilt zeroed
[60s] tilt = 0.012°   |g| = 1.004 g   T = 24.3 °C   (n=6000, fail=0)
[60s] tilt = 0.015°   |g| = 1.004 g   T = 24.4 °C   (n=5998, fail=2)
...
```

After a reboot:

```
MPU6050 ready. Send 'z' after ~60 s to set baseline.
[60s] tilt = --   ...   (send 'z' to zero)   ← baseline lost; must re-zero deliberately
```

## Explicit non-goals for v1 (do not implement)

- No WiFi, no Supabase, no HTTP.
- No deep sleep / light sleep / power management.
- No flash/NVS persistence of the baseline (RAM only — reboot loses it). This
  is the known v1 limitation; persistence is the immediate next step after v1.
- No alarm logic (sustained-delta / sudden-jump thresholds).
- No calibration beyond the `z` zeroing.
- No gyro, no FIFO, no interrupts.

## Implementation notes / pitfalls for the coder

1. **No `delay()` anywhere.** All timing via `millis()` deltas.
2. **`int32_t` accumulators**, never `float` — a 60 s window holds ~6000
   samples; float would lose precision in the sum.
3. **Tilt math = `atan2(|cross|, dot)`**, not `acos(dot)`. acos is numerically
   unstable near 0°, which is exactly the range we care about.
4. **No need to clamp** `dot` to [-1,1] — `atan2` handles out-of-range
   gracefully even if float error nudges it slightly.
5. **`readAccel` does three separate reads**, not a burst. Burst produced
   garbage Z on this specific board.
6. **Do not call `Wire.setClock`** — 100 kHz default is the validated working
   clock.
7. **Comment heavily** — the audience is a beginner; explain *why* (e.g., why
   int32 not float, why atan2 not acos, why three reads not burst).
8. On the `'z'` path, reset the accumulator after zeroing so the next report
   starts clean.

## Compile & verify

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 sensor_node/
```

Expected: clean compile, ~23% flash. At runtime: boot line, then one `[60s]`
line per minute. `n` should be ~6000; `fail` should be 0 on a healthy bus.
`|g|` should be within ~1% of 1.000. After `z`, `tilt` should read in the
0.00–0.05° range at rest (noise floor of the 60 s average).
