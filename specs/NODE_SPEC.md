# Node Spec — `sensor_node` (ESP32 + TCA9548A + MPU6050)

> The firmware that runs on every ESP32 box in a pipe. Master and slave run
> the **same firmware**; the master just *also* runs a small relay module.
> This spec captures every decision made across the design conversations.
> Cross-refs: [BACKEND_SPEC.md](./BACKEND_SPEC.md),
> [MOBILE_APP_SPEC.md](./MOBILE_APP_SPEC.md), [ML_SPEC.md](./ML_SPEC.md).

## 1. Purpose & philosophy

Each node is a **shoring-movement detector**. It samples its MPU6050s,
computes tilt from an install-time baseline, evaluates a raw threshold alert
locally, and streams tagged readings toward the cloud. The node **measures
and exposes**; the server **decides** (features, anomaly model, alerting
logic). The node never learns what movement *means*.

Scope of the **project** (not the node): monitor shoring **after** excavation
is complete and personnel are working in the finished dig. Baselines are set
on a settled, unloaded wall — so a press-to-zero is safe and no confirm window
is needed.

## 2. Hardware

### 2.1 Components per node
- 1× ESP32 (any devkit variant with GPIO 21/22 free).
- 1× TCA9548A I²C multiplexer at address `0x70` (A0/A1/A2 tied low).
- Up to 4× MPU6050 breakouts (GY-521-compatible, WHO_AM_I reports `0x70` —
  MPU-6500 die; register-compatible with MPU6050 for accel/temp).
- 1× momentary button (baseline / gateway).
- 1× LED (status).
- 1× RS485 transceiver (e.g., MAX485) for bus chaining.
- (Optional) buzzer/siren for the local alert.

### 2.2 Wiring (critical for reading quality — see [PHYSICAL_ARCHITECTURE_SPEC.md](./PHYSICAL_ARCHITECTURE_SPEC.md) for the full layout)
- **TCA + ESP32 centered in the node's 2 m span**, with 4 sensors splayed
  symmetrically: two at ±0.5 m, two at ±1.0 m. **Max wire run is 1 m** (down
  from 4 m in the old layout) — this puts the I²C bus well inside its
  comfort zone and largely eliminates the flaky-long-bus failure mode.
- **Star topology from the TCA9548A** (at the ESP32) to each MPU6050 — NOT a
  daisy chain. Each sensor gets its own dedicated cat6 drop (max 1 m).
- **Cat6 per drop**, one drop per sensor. Map the 4 twisted pairs:
  - pair 1: SDA + SCL (the signal pair — keep twisted right up to the breakout)
  - pair 2: 5 V + GND (power pair)
  - pair 3: spare / doubled GND (optional at 1 m)
  - pair 4: spare / shield drain if shielded
- **Power the breakouts at 5 V** on their `VCC` pin (the onboard regulator
  drops to 3.3 V locally). Confirmed working on the bench; at 1 m the drop
  is negligible.
- **Pull-ups: try the onboard 10 kΩ first.** The GY-521 usually has 10 kΩ
  pull-ups already. At 1 m these are almost certainly sufficient. **Only if
  a sensor glitches**, add 4.7 kΩ at that breakout (SDA→3.3 V, SCL→3.3 V).
  Do **not** pull up to 5 V — that damages the ESP32's 3.3 V pins. Don't
  solder preemptively; let the data decide.
- **Common ground** across ESP32 + all sensors, low-resistance.
- **Bus clock: 100 kHz** (default, no `setClock). At 1 m this is rock-solid.

### 2.3 GPIO map (defaults — confirm per board)
- SDA = 21, SCL = 22 (I²C to the TCA9548A).
- Button = GPIO 0 (the onboard BOOT button on most devkits — zero extra hw).
- LED = GPIO 2 (the onboard blue LED on most devkits).
- RS485 transceiver DE/RE = a free GPIO (e.g., GPIO 4); RO/DI to a UART.

## 3. Sensor configuration

```cpp
struct SensorDef { const char* name; uint8_t channel; };
const SensorDef SENSORS[] = {
  { "S1", 7 },
  { "S2", 3 },
  // { "S3", 5 },   // add up to 4
  // { "S4", 1 },
};
const uint8_t NUM_SENSORS = sizeof(SENSORS) / sizeof(SENSORS[0]);
```

Adding a sensor = one line. Sample/report/zero loops iterate the array.

## 4. Validated facts (do NOT deviate)

- **Chip WHO_AM_I = 0x70** (MPU-6500 die). Code never gates on this; presence
  is checked via I²C ACK only.
- **I²C addr `0x68`**, SDA 21 / SCL 22, **100 kHz** (no `setClock`).
- **Read method: three separate 2-byte register reads** (write reg with
  repeated-start, then `requestFrom(2)`). **No 6-byte burst** — it produced
  garbage Z values on this board. **No Adafruit library** — its WHO_AM_I gate
  rejects 0x70.
- **Bus is reliable only with WiFi OFF** on slaves. The master's WiFi is fine
  because it's at the surface with a good signal; slaves have no WiFi.
- At rest: `|g|` ≈ 1.008 g, per-sample noise ≈ ±50 counts.

## 5. Sampling & reporting

- **Sample rate:** 100 Hz per sensor (every 10 ms, all present sensors).
- **Averaging window:** 1 s (bench). Each report = mean of ~100 samples per
  sensor. `int32_t` accumulators (exact; float only at report time).
- **Report cadence:** 1 s (bench and deployment stream). The backend
  downsamples to 1 min for long-term storage; the node always emits 1 s.
- **Non-blocking:** all timing via `millis()` deltas. **No `delay()`** in the
  loop (only boot-time delays).
- **Output table format** (per second, per sensor):
  ```
  time |    S1                       |    S2
  (s)  |  tilt   |g|    T   n/fail   |  tilt   |g|    T   n/fail
  ------+---------------------------+---------------------------
   1.0 | 0.012 0.999 47.2  100/0    | 0.034 1.001 47.5  100/0
  ```
  Header reprints every 20 rows. `--` placeholders keep columns aligned when
  no baseline / no samples.

## 6. Tilt computation (v2 — magnitude only)

Per sensor, at install, save the unit gravity vector as the baseline
`(bx, by, bz)` (the `z` command / button). Each report:

```
gx = mean_ax / 16384.0   (etc.)      # raw counts → g
mag = sqrt(gx² + gy² + gz²)           # |g| health check, must be ≈ 1.000
u = (gx, gy, gz) / mag                # current unit gravity vector
dot = u · b                            # cos θ
cross = u × b                          # vector; |cross| = sin θ
tilt = atan2(|cross|, dot) × 180/π    # degrees, [0°, 180°]
```

**Why `atan2(|cross|, dot)`, not `acos(dot)`:** acos is numerically blind
near 0° (exactly where we need resolution). `atan2` stays sharp to 0.001°.

**What's discarded (v3, not adopted):** the *direction* of tilt (which way
the wall leaned). The team decided v2's magnitude is sufficient for the
alert + anomaly-on-trend model. The cross-product vector still carries
direction if ever needed later — it's a reporting change, not new hardware.

## 7. Baseline management

### 7.1 Storage tiers (priority order)
| Layer | Survives | Role |
|---|---|---|
| Supabase | everything | source of truth, shared, auditable |
| NVS (ESP32 flash) | reboot, WiFi outage | local cache / fallback |
| RAM | nothing | working copy the tilt math uses |

- **SET:** capture → RAM → NVS → upsert to Supabase (via the master). If WiFi
  is down at SET time, NVS holds it; upload retries when WiFi returns.
- **LOAD (manual or automatic-at-boot):** try Supabase first → refresh NVS +
  RAM. If Supabase unreachable, fall back to NVS. If neither, "no baseline —
  use SET."
- **Tilt math** always reads from RAM.
- **Never auto-re-zero on boot.** Re-zeroing is an explicit, deliberate action
  only. A crash must not silently reset the reference.

### 7.2 Boot sequence (the power-interruption fix)
```
1. Power on, LED off.
2. Read MAC (esp_efuse / WiFi.macAddress — stable, unique, no WiFi needed).
3. Connect WiFi (master) / wait for RS485 poll (slave).
4. LED fast-blink → fetch baseline from Supabase (master: directly; slave:
   via the master relay). Fall back to NVS if unreachable.
5. Baseline loaded → LED solid → start monitoring.
6. No baseline anywhere → LED off → wait for SET.
```
A reboot with WiFi up → seamless re-fetch. A reboot with WiFi down → NVS
fallback → seamless. **No operator action on a normal reboot.**

### 7.3 The install button + LED (one of each, combined)

| LED state | Meaning |
|---|---|
| Off | no baseline loaded (not ready, press the button) |
| Fast blink | busy — capturing/uploading/downloading baseline, or becoming gateway |
| Solid on | baseline loaded, monitoring normally (normal sensor node) |
| Solid + heartbeat flicker | baseline loaded AND this box is the gateway |
| Slow blink | error (no WiFi when expected, no baseline in DB, config problem) |

**One momentary button, two actions by hold duration:**
- **Short press (tap, < 1 s)** → SET BASELINE (this box only): capture,
  cache to NVS, upload to Supabase.
- **Long press (hold ≥ 3 s)** → SET GATEWAY (this box becomes the master):
  persist `is_gateway` flag to NVS, start the relay module.
- 1–3 s hold → dead zone (can't mis-time; you tap or you commit to the long
  hold).
- The 3 s hold is the safety guard against accidental bumps — same principle
  as the baseline button. You can't accidentally hold a button for 3 seconds.

### 7.4 Global baseline capture (the inaccessible-slaves fix)
Pressing SET GATEWAY (long press) on the master **also** broadcasts a
"capture baseline now" command down the RS485 chain. Every slave captures its
own gravity vector simultaneously, caches to its own NVS, and uploads via the
master. The master captures its own too. **One human action at the top zeros
the whole pipe.**

This is safe because the project scope is **after digging**: the wall is
settled and unloaded when the button is pressed, so simultaneous capture is a
true reference. No confirm window needed. Operational rule: "set baselines
after the wall has settled, not the instant the dig ends."

### 7.5 Serial debug equivalents (kept)
- `z` → SET BASELINE (same as short press).
- `g` → SET GATEWAY (same as long press).
- `l` → LOAD baseline from Supabase / NVS.
The firmware works with or without the physical button/LED attached.

## 8. Node identity & data tagging

- **MAC address** (ESP32 efuse MAC, via `WiFi.macAddress()` or
  `esp_efuse_mac_get_default()`) is the node's unique identity. Stable,
  factory-burned, zero-config. Works on master and slaves, WiFi-on-or-off.
- **Every reading is tagged `(node_mac, channel, tilt, |g|, T, n, fail)`.**
  The channel disambiguates the 4 sensors within a node; the MAC
  disambiguates the node within the pipe. The backend resolves the rest
  (pipe, site, user) — the node never knows those.
- **Every baseline upload is tagged `(node_mac, channel, bx, by, bz,
  captured_at)`.**
- **Device-level API key** for Supabase auth (one shared service key in NVS
  for v1; per-device keys later if needed). **Never user JWTs** — the node is
  a device, not a person. User auth lives in the mobile app.
- The node writes only its own rows (enforced by Supabase RLS or a
  "device can only insert readings tagged with its own MAC" policy).

## 9. Master / slave roles (same firmware, add-on relay)

**Every node runs the full sensor brain** (sampling, averaging, tilt,
baseline, button, LED, local threshold alert). Roles differ only in
transport:

- **Slave (in the trench, no WiFi):** computes readings, hands them up the
  RS485 bus to the master when polled. Also answers "capture baseline"
  broadcasts. Its MAC tags every reading it sends.
- **Master (top, has WiFi):** computes its own readings (it's a sensor node
  too — the top panel is a real shoring panel) AND runs a small **relay
  module**: polls each slave over RS485, collects their tagged readings,
  bundles (its own + all slaves') and POSTs to Supabase using the device key.
  Each row carries the **originating** MAC — the master is a postman, not the
  author. The master also relays slave baseline uploads/downloads.

**Gateway role is assigned by the long-press, persisted to NVS.** No election
protocol, no DIP switches — a human explicitly chose this box. Recovery: if
the master dies, swap it and long-press the new top box. You *know* a role
change happened because a human did it (no silent failover on a safety
device).

### 9.1 Master→Supabase batching
- Bundle readings and POST every ~5 s (not one request per second) over a
  **reused** HTTPS connection (keep-alive). A warm batch POST is ~200 ms,
  comfortably inside the 5 s window. 5 s dashboard latency is invisible for
  shoring.
- **Bounded buffer** (~60 readings) absorbs WiFi hiccups. Sampling never
  blocks on HTTP. On failure, leave readings in the buffer and retry next
  batch.
- For v1 testing: `client.setInsecure()` is fine. For production: pin
  Supabase's CA cert.

## 10. Local threshold alert (the safety layer)

- Every 1 s, each node checks `tilt > ENGINEER_SET_DEGREES` AND (for
  multi-sensor agreement) the sensors on the node broadly agree (real wall
  event, not a single-sensor glitch).
- If crossed → **immediate local indicator** (LED / buzzer) + a priority
  `alerts` row pushed to the cloud (not waiting for the 5 s batch).
- This alert **never depends on WiFi, the cloud, or the ML.** It's the floor
  that keeps working when everything else is down.
- The engineer-set threshold is configured per pipe/site (in the app) and
  pushed down to nodes; nodes cache it in NVS.

## 11. File layout (current)

```
sensor_node/
├── sensor_node.ino     ← table + per-sensor state + non-blocking loop + button/LED state machines
├── MPU6050.h           ← TCA addr + labeled registers + channel-aware class
├── MPU6050.cpp         ← tcaSelect() (no delay) + reads + probe()
├── SPEC.md             ← (older v2 spec; superseded by this file)
└── archive/            ← earlier abstraction files, not compiled
```

Phased additions:
- **Phase 1 (this branch, `feat/sensor`):** button state machine + LED state
  machine + NVS baseline persistence. Works without WiFi.
- **`feat/transport`:** RS485 transport module (swappable with WiFi), the
  master relay module, Supabase baseline sync, MAC-tagged stream, batching.

## 12. Explicit non-goals for the node

- No direction/v3 tilt (decided).
- No user auth (device key only).
- No ML on the node.
- No WiFi on slaves.
- No auto-failover of the gateway role (explicit human action only).
- No 6-byte burst reads. No Adafruit library. No `setClock`.

## 13. Compile & verify

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 sensor_node/
```
Expected: ~22% flash, clean. At runtime: boot scan lists each sensor
`present`/`MISSING`; one table row per second per sensor; `n` ≈ 100, `fail`
≈ 0, `|g|` within 1% of 1.000; resting `tilt` within ±0.02° after zeroing.
