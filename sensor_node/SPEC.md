# Spec: `sensor_node` N-sensor tiltmeter (TCA9548A multiplexed, v2)

## Goal

One ESP32 reads up to **4 MPU6050s** through a **TCA9548A** I²C multiplexer
(at `0x70`). Each sensor has its **own** baseline and its **own** tilt reading.
Sampling is 100 Hz per sensor, averaged over a 1 s window (bench), reported
once per second. `z` over serial zeroes **all** sensors' baselines (each
captures on its next full report window). No WiFi, no Supabase, no sleep, no
alarm logic — same v1 scope, now multi-sensor.

## Locked configuration

- TCA9548A address: `0x70`.
- Currently 2 sensors: **S1 → channel 7**, **S2 → channel 3**.
- Max 4 per TCA (cost ceiling). Adding a 3rd/4th = one line in the table.
- `z` = zero all (no individual zeroing).

## Validated facts (do NOT deviate)

- **Chip**: `WHO_AM_I = 0x70` (MPU-6500 die on a "MPU6050" module). The code
  never gates on this — presence is checked via I²C ACK only, so clones work.
- **I²C**: addr `0x68`, SDA 21 / SCL 22, 100 kHz default (no `setClock`).
- **Read method that works**: three separate 2-byte register reads. No burst
  (it produced garbage Z earlier). No Adafruit library (its WHO_AM_I gate
  rejects 0x70).
- **Bus is reliable only with WiFi OFF.** v2 has no WiFi.
- At N≤4 sensors, three reads at 100 kHz stays under ~60% bus utilization per
  10 ms tick — comfortable. (N≥5 would need burst or rate reduction; out of scope.)

## File layout

```
sensor_node/
├── sensor_node.ino     ← sensor table + per-sensor state + non-blocking loop
├── MPU6050.h           ← TCA addr + labeled registers + channel-aware class
├── MPU6050.cpp         ← tcaSelect() (no delay) + reads + probe()
└── SPEC.md             ← this file
```

## Architecture — N-compatible from day one

### Sensor definition table (the scalability knob)

```cpp
struct SensorDef { const char* name; uint8_t channel; };
const SensorDef SENSORS[] = {
  { "S1", 7 },
  { "S2", 3 },
};
const uint8_t NUM_SENSORS = sizeof(SENSORS) / sizeof(SENSORS[0]);
```

Adding a sensor = adding a line. Sample/report/zero loops iterate the array;
they never hardcode a count.

### Per-sensor runtime state (parallel array)

```cpp
struct SensorNode {
  MPU6050 mpu;
  bool     present;
  int32_t  sumX, sumY, sumZ;        // int32 = exact sum, no float drift
  uint32_t sampleCount, failCount;
  float    bx, by, bz;              // this sensor's baseline (unit vector)
  bool     hasBaseline, zeroPending;
};
```

Each sensor's baseline/accumulators are independent — zeroing or losing one
never affects another.

### Channel-aware `MPU6050` class

- `begin(channel)` stores the channel, selects it, wakes the chip.
- `probe()` does an ACK check at the MPU address (chip-agnostic presence).
- `readAccel` / `readTemperatureC` call a private `select()` (= `tcaSelect`,
  no delay) **once** at their start. The TCA stays on that channel until the
  next call, so the 3 reads land on the right sensor.
- `Wire.begin(21,22)` is called once in `setup()`; `begin()` does NOT call it.

### `loop()` — three iterating blocks, no `delay()`

1. **Sample** (every 10 ms): for each present sensor, `readAccel` → accumulate
   into its sums, or bump its failCount.
2. **`z` handler**: on `z` over serial, set `zeroPending = true` on **all**
   present sensors; print `zero pending — all sensors baseline on next report`.
3. **Report** (every 1 s): for each present sensor — compute mean → `|g|` →
   tilt from its own baseline → temperature; if `zeroPending`, capture this
   window as its baseline and print confirmation. Then print one line per
   sensor and reset that sensor's window.

## Behavior contract

```
Scanning 2 sensors...
S1 (ch7): present
S2 (ch3): present
MPU6050 ready. Send 'z' to set baseline (applies on next report).
[1s] S1  tilt = --   |g| = 0.999 g   T = 47.2 °C   (n=100, fail=0)
[1s] S2  tilt = --   |g| = 1.001 g   T = 47.5 °C   (n=100, fail=0)
z
zero pending — all sensors baseline on next report
baseline S1 set: (1.0000, 0.0180, -0.0340) — tilt zeroed
baseline S2 set: (0.9990, 0.0210, -0.0310) — tilt zeroed
[1s] S1  tilt = 0.000°  |g| = 0.999 g   T = 47.2 °C   (n=100, fail=0)
[1s] S2  tilt = 0.000°  |g| = 1.001 g   T = 47.5 °C   (n=100, fail=0)
```

After a reboot: **all baselines are lost**; re-`z` deliberately.

## Explicit non-goals for v2 (do not implement)

- No WiFi, no Supabase, no HTTP.
- No deep/light sleep, no power management.
- No flash/NVS persistence of baselines (RAM only — reboot loses them all).
  This is the known v2 limitation; persistence is the immediate next step.
- No alarm logic (sustained-delta / sudden-jump thresholds).
- No calibration beyond `z` zeroing.
- No gyro, no FIFO, no interrupts.
- No burst reads, no individual (`1`–`8`) zeroing, no multi-mux. (Single TCA
  at 0x70, ≤4 sensors, `z`=all — per the locked config.)

## Implementation notes / pitfalls

1. No `delay()` in `loop()`. The only delays are boot-time (`delay(500)` scan
   settle, `delay(100)` per-sensor wake).
2. `int32_t` accumulators, never `float` for the running sum.
3. Tilt = `atan2(|cross|, dot)`, not `acos(dot)`.
4. `readAccel` does three separate reads, selects the channel once per call.
5. No `Wire.setClock` — 100 kHz is the validated working clock.
6. Missing sensors (probe fails) are flagged at boot and skipped in sample/report.

## Compile & verify

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 sensor_node/
```

Expected: clean compile, ~22% flash. At runtime: boot scan lists each sensor as
`present`/`MISSING`, then one pair of `[1s]` lines per second (one per sensor).
`n` ≈ 100, `fail` ≈ 0, `|g|` within ~1% of 1.000 per sensor. After `z`, each
sensor's `tilt` reads ~0.000° then wanders within ±0.02° at rest.
