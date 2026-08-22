# Physical Architecture Spec — Pipe layout & wiring topology

> How the boxes and sensors are physically arranged on a shoring wall, how
> boxes chain into a pipe, and the coverage/span math. This is the spec that
> sits between the electrical design ([NODE_SPEC.md](./NODE_SPEC.md) §2) and
> the data hierarchy ([BACKEND_SPEC.md](./BACKEND_SPEC.md) §2).
> Cross-refs: [NODE_SPEC.md](./NODE_SPEC.md), [BACKEND_SPEC.md](./BACKEND_SPEC.md).

## 1. Revised node layout — TCA + ESP32 in the center

Previous design: TCA at the top, sensors daisy-wired 1 m apart down a 4 m
span (max wire run 4 m). **Revised:** the TCA + ESP32 sit in the **middle**
of the node's span, with sensors splayed symmetrically left and right.

```
                 ┌──────────┐
   S4 ← 0.5 m →  │          │ ← 0.5 m → S1
   S2 ← 0.5 m →  │ TCA+ESP32 │ ← 0.5 m → S3
                 │   +PWR   │
                 └──────────┘
   ←── 1.0 m ──→   (center)   ←── 1.0 m ──→

   |‹── 2.0 m sensor-to-sensor span ──›|
```

### 1.1 Sensor positions (relative to the TCA, along the wall)
| Sensor | Side | Distance from TCA | TCA channel (suggested) |
|---|---|---|---|
| S1 | right, near  | 0.5 m | 7 |
| S3 | right, far   | 1.0 m | 5 |
| S2 | left, near   | 0.5 m | 3 |
| S4 | left, far    | 1.0 m | 1 |

(Channel numbers are arbitrary as long as firmware's `SENSORS[]` table matches
the physical wiring — pick a convention and label it at assembly.)

### 1.2 Why this is better electrically
- **Max wire run drops from 4 m → 1 m.** At 1 m the I²C bus is in its comfort
  zone — onboard 10 kΩ pull-ups on the GY-521 are almost certainly sufficient,
  4.7 kΩ add-ons are very unlikely to be needed, and 100 kHz is rock-solid.
  The whole "flaky long-bus" failure mode we fought on the bench basically
  disappears at 1 m.
- **Balanced capacitance** — the two longest runs (1 m) are symmetric, so bus
  timing is uniform across sensors.
- **Shorter, tidier harness** — no 4 m drops to route and protect.

### 1.3 Coverage per node (with sensing slack)
A sensor doesn't only measure at its exact mounting point. On a continuous
wall, a bend or rotation in the region near a sensor moves that sensor too —
so each sensor effectively covers a neighborhood around its position. We
assume **~0.5 m of sensing slack** beyond each outermost sensor.

- **Outermost sensors** sit at the 0 m and 2 m marks (−1.0 m and +1.0 m from
  the TCA center) → 2 m apart, sensor-to-sensor.
- **Effective coverage** = 0.5 m left slack + 2.0 m sensor span + 0.5 m right
  slack = **3.0 m per node**, centered on the box (−1.5 m to +1.5 m).
- **Sensor density:** 1 sensor per 0.5 m within the 2 m sensor span; the
  0.5 m slack zones at each end are covered by the nearest sensor only.
- The slack is an engineering estimate, not a hard radius — it depends on
  wall rigidity (a rigid wall transmits movement further; a flexible wall
  localizes it). 0.5 m is conservative for typical shoring panels.

## 2. Pipe — chaining nodes vertically

A **pipe** is a vertical chain of these nodes on one shoring run. With 3 m
effective coverage per node, **spacing nodes 3 m center-to-center gives
seamless coverage** (each node's −1.5 m … +1.5 m zone meets the next at the
boundary):

```
   surface ─────────────────────────────────────────  depth 0
        ▒▒▒▒▒▒▒▒▒▒  ← Node 1 (GATEWAY, top)
        │             coverage −1.5 m … +1.5 m
        │ RS485 ↓ 3 m
        ▒▒▒▒▒▒▒▒▒▒  ← Node 2
        │             coverage +1.5 m … +4.5 m
        │ RS485 ↓ 3 m
        ▒▒▒▒▒▒▒▒▒▒  ← Node 3
        │             coverage +4.5 m … +7.5 m
        │ RS485 ↓ 3 m
        ▒▒▒▒▒▒▒▒▒▒  ← Node 4
        │             coverage +7.5 m … +10.5 m
        │
        … (repeat to the dig floor) …
```

### 2.1 The spacing tradeoff (a decision for the team)

| Spacing (center-to-center) | Coverage result | Nodes for 10 m depth |
|---|---|---|
| **3.0 m** (seamless) | zones meet edge-to-edge; **boundary is the thinnest sensing zone** (1 m gap between outer sensors, covered only by both slacks meeting at the midpoint) | 4 |
| **2.5 m** (compromise) | 0.5 m overlap of coverage zones; outer sensors within each other's slack | 4 |
| **2.0 m** (overlapping) | outer sensors of adjacent nodes sit at the **same depth** → two independent measurements of the same point, strong cross-check; ~33% more nodes | 5 |

For a **safety device**, the conservative choice is **overlap** (2.0–2.5 m
spacing): you get sensor-pair cross-checks at every boundary, which is both a
fault-detection feature (a single-sensor glitch is caught by its neighbor)
and a gift to the ML's multi-sensor-agreement feature. The cost is ~33–50%
more nodes per pipe. **Seamless 3 m spacing** minimizes nodes but leaves the
boundary as the weakest detection zone — acceptable if you trust the slack
estimate and want minimum hardware. The team should pick based on the
risk-vs-cost appetite. (Below, the coverage table uses **2.5 m** as the
recommended compromise.)

### 2.2 Coverage estimates for common excavation depths (at 2.5 m spacing)
| Excavation depth | Nodes per pipe | Sensors per pipe | RS485 bus length |
|---|---|---|---|
| 4 m  | 2  | 8  | ~2.5 m  |
| 6 m  | 3  | 12 | ~5 m    |
| 10 m | 4  | 16 | ~7.5 m  |
| 14 m | 6  | 24 | ~12.5 m |
| 20 m | 8  | 32 | ~17.5 m |
| 30 m | 12 | 48 | ~27.5 m |

(At 3.0 m seamless spacing, divide node/sensor counts by ~0.83 — e.g., 10 m
→ 4 nodes/16 sensors; 20 m → 7 nodes/28 sensors. At 2.0 m overlapping,
multiply by ~1.25 — e.g., 10 m → 5 nodes/20 sensors.)

RS485 is rated to ~1 km — even a 30 m dig is trivial for the bus. The
limiting factor is never RS485 length; it's install practicality (cable
runs, power distribution, number of boxes to mount).

### 2.3 Multiple pipes per site
A site can have several pipes (e.g., "North Wall," "East Wall," "South Wall")
— each an independent chain with its own gateway at the surface. Pipes don't
share an RS485 bus; each is its own bus. The backend ([BACKEND_SPEC](./BACKEND_SPEC.md))
keys them by `pipe_id` under the site.

## 3. Wiring within a node

### 3.1 Sensor drops (TCA → each MPU6050)
**Star topology from the TCA**, one cat6 drop per sensor (4 drops per node),
max 1 m each:

```
                    ┌── TCA9548A ──┐
                    │   (at ESP32)  │
   ┌── S4 (1m) ─────┤ ch1           ├─ (1m) S3 ──┐
   │                │               │            │
   ├── S2 (0.5m) ───┤ ch3           ├─ (0.5m) S1─┤
   │                └───────────────┘            │
   └─────────────────────────────────────────────┘
```

Per cat6 drop (4 twisted pairs available, only 2-3 needed):
- **pair 1:** SDA + SCL (signal — keep twisted to the breakout)
- **pair 2:** 5 V + GND (power)
- **pair 3:** doubled GND (optional at 1 m, useful for the 1 m runs)
- **pair 4:** spare

### 3.2 Power
- **5 V to each breakout's VCC** (onboard regulator → local 3.3 V).
  Confirmed working on the bench; at 1 m the voltage drop is negligible.
- **Common, low-resistance ground** across all sensors + ESP32.
- **3.3 V for the I²C pull-up reference** (the onboard 10 kΩ pull to the
  breakout's 3.3 V pin — do NOT pull to 5 V).

### 3.3 Pull-ups
- **Try onboard 10 kΩ first.** At 1 m, almost certainly sufficient.
- Add 4.7 kΩ at a sensor **only if that sensor's reads glitch** — let the
  data decide, don't solder preemptively.

## 4. Wiring between nodes (the RS485 chain)

```
   [Node 1] ──RS485── [Node 2] ──RS485── [Node 3] ──RS485── …
```

- **Daisy-chained RS485** (A, B, GND) between adjacent node boxes — length
  equals the chosen node spacing (2.0–3.0 m per link).
- **Termination resistors (120 Ω)** at the two physical ends of the bus
  (first and last node) — standard RS485 practice. Without them you risk
  reflections on longer chains; with them, the bus is bulletproof.
- **Optional: power on the same chain.** If nodes are mains-powered locally,
  RS485 is just signal. If you want to power the whole pipe from the top,
  add 5 V + GND conductors alongside A/B (use a 4-conductor cable or a second
  cat6 pair). Watch voltage drop on deeper nodes — at 20 m of 23 AWG, 5 V
  might droop enough that deeper nodes need local regulation or heavier
  gauge. Simplest: each box taps local power (mains at the shoring).

### 4.1 RS485 transceiver per node
- MAX485 (or similar) per ESP32.
- DE/RE tied together to one GPIO (drive HIGH to transmit, LOW to receive).
- RO → UART RX, DI → UART TX.
- Software: half-duplex, the master polls one slave at a time, slaves answer
  only when polled (no collisions).

## 5. The gateway (master) node's physical position

- **Node 1, at the surface.** Its box is at depth 0, so it has WiFi (site
  router) and its sensors cover the top ~3 m of the wall (the node's coverage
  zone, centered on the surface).
- It runs the **full sensor brain** (it's a real sensor node for the top
  panel) **plus** the small relay module (poll slaves, POST to Supabase).
- Its long-press sets `is_gateway` and triggers global baseline capture.
- The gateway's own 4 sensors are real monitoring points, not wasted.

## 6. Install physical checklist (per pipe)

1. Mount node 1 (gateway) at the surface, centered on the top of the wall.
2. Run 4 cat6 drops (≤1 m) to its 4 sensors; land S1/S3 right, S2/S4 left.
3. Mount node 2's box one spacing-length below node 1's box (2.0–3.0 m per
   the spacing decision); wire its 4 sensors.
4. Run RS485 (A/B/GND) between node 1 and node 2; add 120 Ω at node 1's
   "upstream" end (it's the top of the bus).
5. Repeat for each node down to the dig floor.
6. Add 120 Ω at the last (deepest) node's downstream end.
7. Power: local mains at each box, OR a single 5 V feed from the top with
   adequate gauge.
8. Power on; the boxes self-organize (master relays, slaves answer polls).
9. Wait for the wall to settle (operational rule — see
   [NODE_SPEC.md §7.4](./NODE_SPEC.md)).
10. Long-press the gateway button → global baseline capture → LEDs go solid
    → monitoring live.

## 7. Decisions locked by this layout

- **TCA + ESP32 centered**, 4 sensors splayed ±0.5 m / ±1.0 m, **max wire
  run 1 m**, **~3 m effective coverage per node** (2 m sensor span + 0.5 m
  slack each end).
- **Node spacing: 2.5 m center-to-center recommended** (overlap for safety);
  3.0 m seamless (min hardware) or 2.0 m (max redundancy) are the bookends.
- **Star wiring per sensor** (cat6 drops), **5 V local power**, **onboard
  pull-ups first**.
- **RS485 daisy-chain** between nodes, **120 Ω termination at both ends**.

## 8. Open / to-decide

1. **Node spacing** — 2.0 m (max redundancy) / 2.5 m (recommended) / 3.0 m
   (min hardware)? This is the core risk-vs-cost decision; see §2.1.
2. **Power strategy:** local mains per box vs. single top-fed 5 V supply.
   Local mains is simpler and avoids deep-node voltage drop; top-fed is one
   fewer wall-wart per box. Pick based on what the site actually provides.
3. **Sensor-to-channel mapping convention** — confirm the S1=ch7, S2=ch3,
   S3=ch5, S4=ch1 suggestion (or pick your own) and label it at assembly so
   firmware's `SENSORS[]` matches the wires.
4. **Boundary overlap usage** — do you want adjacent nodes' boundary sensors
   explicitly compared in firmware (free cross-check), or just left as
   independent readings that the ML/server can correlate? Firmware-side is a
   small addition; server-side is the default. (Only meaningful if you pick
   overlapping spacing.)
