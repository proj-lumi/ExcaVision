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
- **1× buzzer/siren PER NODE** — one audible alarm on every box, for
  maximum sound output along the whole wall. A crew working in the trench
  near a lower box hears that box's buzzer, not just the distant surface one;
  every box screaming = loudest coverage.

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
- **Button = GPIO 16** (external momentary button; `INPUT_PULLUP` — HIGH when
  open, LOW when pressed).
- **LED = GPIO 23** (external LED; anode → 220 Ω → GND).
- **Buzzer = free pin (suggested GPIO 17 or 18)** — added with the threshold
  alert step.
- RS485 transceiver DE/RE = a free GPIO (e.g., GPIO 4); RO/DI to a UART.
- **Bench-only alternative:** the onboard BOOT button (GPIO 0) and onboard
  blue LED (GPIO 2) work with zero external hardware — only the constants in
  `Config.h` (`BUTTON_PIN` / `LED_PIN`) change.

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
- **LOAD (manual or automatic-at-boot):** **NVS first.** The node's own
  flash is instant and works with zero network, so a normal reboot uses it
  directly. Only if NVS is EMPTY (replacement board / wiped flash) do we
  recover from the cloud: the master fetches directly; a slave asks the
  master over RS-485 (it has no WiFi). If neither has it → "no baseline —
  use SET."
- **Tilt math** always reads from RAM.
- **Never auto-re-zero on boot.** Re-zeroing is an explicit, deliberate action
  only. A crash must not silently reset the reference.

### 7.2 Boot sequence (the power-interruption fix)
```
1. Power on, LED off.
2. Read MAC (esp_efuse / WiFi.macAddress — stable, unique, no WiFi needed).
3. Connect WiFi (master) / wait for RS485 poll (slave).
4. Load baseline from **NVS** (instant, offline). Only if NVS is empty,
   recover from the cloud (master: directly; slave: via the master relay
   `F;`→`Q;`).
5. Baseline loaded → LED solid → start monitoring.
6. No baseline anywhere → LED off → wait for SET.
```
A normal reboot → NVS serves instantly, no network needed; the cloud is
only consulted when local memory is empty. **No operator action on a
normal reboot.**

### 7.3 The install button + LED (one of each, combined)

| LED state | Meaning |
|---|---|
| Off | no baseline loaded, or no sensors present (not ready, press the button) |
| Fast blink | busy — collecting / uploading / downloading baseline |
| Solid on | baseline loaded, monitoring normally (normal sensor node) |
| Solid + heartbeat flicker | baseline loaded AND this box is the gateway |

> **No error LED state (deliberate).** A runtime "sensor died / bus dead"
> signal was considered and scrapped: a boot-only latched error is misleading
> (it can't detect mid-run failures and won't clear until reboot), and doing
> it right (continuous evaluation + hysteresis + resolution) duplicates what
> the app already does better. So:
> - **Install-time diagnostics** = the boot scan's per-channel `MISSING`
>   serial prints (installer is on a laptop).
> - **Runtime health** = the app, which alarms when a sensor stops reporting.
> - **Local "this box is dead"** = a future buzzer pattern (Step 7), not an
>   LED state.

**One momentary button, two actions by hold duration:**
- **Short press (tap, < 1 s)** → SET BASELINE: begin collecting samples for
  `BASELINE_COLLECT_SECONDS` (default 30 s, configurable); at the end,
  average into the baseline, cache to NVS, upload to Supabase. LED
  fast-blinks during collection. On a SLAVE this is this-box-only; on the
  GATEWAY this IS the global capture (§7.4) — it also broadcasts `C` so every
  node runs its own window simultaneously. **One action at the top zeros the
  whole pipe.**
- **Long press (hold ≥ 3 s)** → TOGGLE GATEWAY (same deliberate hold both
  ways): if this box is not the master it becomes the gateway; if it already
  is the master it returns to a normal sensor node. Persist the `is_gateway`
  flag to NVS, start/stop the relay module accordingly. Toggling off is
  deliberate (a human holding 3 s twice), so an accidental single hold can't
  race-
  toggle it repeatedly.
- 1–3 s hold → dead zone (can't mis-time; you tap or you commit to the long
  hold).
- The 3 s hold is the safety guard against accidental bumps — same principle
  as the baseline button. You can't accidentally hold a button for 3 seconds.

**Baseline collection window (configurable):** `BASELINE_COLLECT_SECONDS`
controls how long samples are collected before the baseline is averaged and
committed (default **30 s** → ~3000 samples at 100 Hz → ~55× noise reduction,
a much cleaner reference than a 1 s snapshot). During collection the baseline
is held in a dedicated per-sensor accumulator, separate from the 1 s report
window. Change the value to trade accuracy vs. install time. Note: the 1 s
"averaging window" in §5 is for *reporting* only; the *baseline* uses this
separate, longer collection window.

### 7.4 Global baseline capture (the inaccessible-slaves fix)
A long press (TOGGLE GATEWAY, see §7.3) becoming the master does **not**
re-capture baselines by itself — but the classic install flow is one long
press to take gateway on the master *plus* the short-press collection on
master and slaves. (In practice the installer long-presses the top box to
become gateway, then runs a global baseline capture command down the RS485
chain. Every node, master included, runs its own `BASELINE_COLLECT_SECONDS`
window, averages into its baseline, caches to NVS, and uploads via the
master.) **One human action at the top zeros the whole pipe.** The trigger is
the gateway's short press (or `z` on the gateway's serial, §7.5): it
broadcasts the `C` frame down the RS-485 chain and starts its own window; the
finished baselines come back via `B;` frames and are uploaded by the master.

This is safe because the project scope is **after digging**: the wall is
settled and unloaded when the button is pressed, so simultaneous capture is a
true reference. No confirm window needed. Operational rule: "set baselines
after the wall has settled, not the instant the dig ends."

### 7.5 Serial debug equivalents (kept)
- `z` → SET BASELINE (same as short press).
- `g` → TOGGLE GATEWAY (same as long press — on becomes off, off becomes on).
- `r` → reboot the box (`esp_restart`) — re-triggers NVS-empty recovery.
- `t` / `t2.5` → show / set the local alert threshold.
- (`l` removed — cloud recovery is automatic at boot; no manual LOAD needed.)
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

**Gateway role is assigned by the physical button long-press ONLY — never
by the app.** The long-press TOGGLES `is_gateway` in this box's own NVS
(hold to become master; hold again to return to a normal node). No election
protocol, no DIP switches, no app toggle — a human explicitly chose this
box with a physical action. Recovery: if the master dies, swap it and
long-press the new top box; the old master, if it ever revives, can be
long-pressed to turn gateway OFF. You *know* a role change happened because
a human did it (no silent failover on a safety device).

**The cloud is informed, not asked.** When a box has set itself as gateway
(NVS flag) and comes online with WiFi, it includes `is_gateway: true` in its
regular POSTs/heartbeat to Supabase. The backend stores that on
`sensor_nodes.is_gateway` for that MAC. So the cloud/app can *display*
"which box is the gateway for this pipe," but the cloud never *sets* it —
the button is the sole source of truth, and the node reports its own role
upstream. If the cloud row and the NVS flag ever disagree, the NVS flag wins
(the box behaves according to its own flag regardless of what the cloud
says).

### 9.x RS-485 frame protocol & the spontaneous-alert caveat

The wire protocol is ASCII, one `\n`-terminated line per message:

| Direction | Frame | Meaning |
|---|---|---|
| master → | `D` | discovery broadcast — who is on the bus? |
| slave → | `H:<mac>` | hello, I am `<mac>` |
| master → | `P:<mac>` | poll that specific node |
| slave → | `R;<mac>;S1@7:v,v,v,v,v;S2@3:...` | readings, name@channel, per sensor: tilt,g,T,n,fail |
| slave → | `A;<mac>;<ch>;<kind>;<sev>;<value>` | **spontaneous** threshold alert |
| slave → | `B;<mac>;<ch>;<bx>,<by>,<bz>` | **spontaneous** baseline capture (master uploads it) |
| master → | `C`                       | broadcast: all nodes capture a baseline |
| master → | `T;<deg>`                 | broadcast: push the alert threshold to every slave |
| slave → | `F;<mac>`                   | ask the master to fetch my baselines from the cloud |
| master → | `Q;<mac>;<ch>:bx,by,bz;…` | reply with a slave's baselines (NVS-empty recovery) |

All frames except `A;` and `B;` are **master-initiated**: the master asks, the slave
answers, so there's exactly one transmitter at a time. The `A;`/`B;` frames are the
exception — the slave sends them **on its own** (alert trip / finished baseline capture),
without waiting to be asked.

**Caveat (accepted for v1):** RS-485 is half-duplex — only one node may
transmit at once. If a slave's spontaneous `A;`/`B;` happens to collide with the
master's own poll on the wire, both frames garble and that one alert can be
lost (it never reaches the cloud). This is acceptable because:

- The **local buzzer already fired** — the frame is only "tell the app too";
  the on-site safety floor doesn't depend on it.
- It's rare: polls are ~1/s, and the collision window is the few ms the two
  transmissions overlap.
- **Readings are unaffected** — a collision just means the master's next poll
  is garbled and retried, as it already handles.

A future refinement (if wanted): a small random back-off before sending `A;`,
or a retry-until-acked scheme — not a v1 blocker.

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

## 10. Threshold alert (the safety layer, evaluated on every node)

**One buzzer per node — maximum sound output.** Every box (master and
slaves) has its own buzzer, so the alarm is loud *everywhere along the
wall*, not just at the surface. A crew working in the trench near a lower
box hears that box's buzzer, not just the distant top one; every box
screaming = loudest coverage and the clearest "something near you is wrong."

- **Every node evaluates the alert locally, for its own 4 sensors, every 1 s.**
  Each node checks each of its sensors' `tilt` against the engineer-set
  threshold.
- **If any of a node's own sensors crosses threshold** → that node fires
  its own buzzer immediately AND pushes a priority `alerts` row to the cloud
  (slaves push via the master relay; the master pushes its own directly),
  tagged with the offending sensor's MAC + channel so the app can show
  *which* sensor tripped. Not waiting for the 5 s batch — the alert row
  goes out now.
- This alert **never depends on WiFi, the cloud, or the ML** for the buzzer.
  Each node fires its buzzer from local data the moment it sees a crossing.
  (The cloud-bound `alerts` row does need WiFi/the relay, but the audible
  alarm doesn't wait for it.)
- The engineer-set threshold is configured per pipe/site (in the app) and
  pushed down to nodes; each node caches it in NVS and applies it to its own
  sensors.
- **Always controllable from the app, in real time.** An engineer opens the
  app, changes the threshold, and every node picks it up within a short
  window — no re-flash, no field visit. Mechanism: the gateway re-polls
  `node_config` every ~15 s and relays the value to
  slaves over RS-485 (frame `T;`) so each node's *local* evaluation uses the
  newest number. Honest tradeoff: this is polling, not push — app→node latency is
  one poll interval (~15 s), which is effectively real-time for shoring
  (a wall moves over hours, not seconds). True push (MQTT / long-poll) is a
  possible later refinement but adds a broker dependency — not needed for
  v1.

**Why a buzzer on every node, not just the master:**
- **Loudest coverage** — N buzzers along the wall >> 1 buzzer at the top.
  Crew in the trench hear the box next to them, not a distant surface alarm.
- **Locality** — the box closest to the failing panel is the one that
  screams, giving the crew a spatial cue ("the sound is coming from below
  me") on top of the alert itself.
- **Resilience** — every node's buzzer fires from its own local data; no
  dependency on the RS485 bus, the master, or WiFi to make noise. A slave
  whose sensors cross threshold screams even if the bus to the master is
  cut. The master's buzzer is a redundant secondary, not the sole alarm.
- **Cost is trivial** — a piezo buzzer is ~$1 per node; the safety gain
  is worth it.

**Tradeoff to decide (team):** with per-node evaluation, do you want each
node to alarm on **any-single-sensor** crossing (loudest, fastest, but a
loose mount on one sensor trips the whole-box buzzer), or require
**multi-sensor agreement within the node** before firing (suppresses
single-sensor glitches, tiny delay)? This is the same glitch-suppression
question as before, now applied per-node rather than pipe-wide.

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
