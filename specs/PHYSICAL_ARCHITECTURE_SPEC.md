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

   |‹── 2.0 m total node span ──›|
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

### 1.3 Coverage per node
- **Span: 2.0 m** (from the far-left sensor at −1.0 m to the far-right sensor
  at +1.0 m, measured along the wall).
- **Sensor density: 1 sensor per 0.5 m** within that 2 m span — fine
  resolution for detecting localized bending or a single-panel failure.
- The node "covers" 2 m of wall, centered on the box.

## 2. Pipe — chaining nodes vertically

A **pipe** is a vertical chain of these nodes on one shoring run. The nodes
are stacked top-to-bottom, each box's center 2 m below the previous one's
center, so each node's 2 m span meets the next seamlessly:

```
   surface ─────────────────────────────────────────  depth 0
        ▒▒▒▒▒▒▒▒▒▒  ← Node 1 (GATEWAY, top)
        │             covers depth −1.0 m … +1.0 m
        │ RS485 ↓ 2 m
        ▒▒▒▒▒▒▒▒▒▒  ← Node 2
        │             covers depth 1.0 m … 3.0 m
        │ RS485 ↓ 2 m
        ▒▒▒▒▒▒▒▒▒▒  ← Node 3
        │             covers depth 3.0 m … 5.0 m
        │ RS485 ↓ 2 m
        ▒▒▒▒▒▒▒▒▒▒  ← Node 4
        │             covers depth 5.0 m … 7.0 m
        │
        … (repeat to the dig floor) …
```

- **Node spacing: 2.0 m center-to-center** → seamless coverage, no gaps.
- **Boundary redundancy:** node 1's lowest sensor (at +1.0 m) sits at the same
  depth as node 2's highest sensor (at +1.0 m). That's a free cross-check
  between adjacent nodes at every boundary — two independent measurements of
  the same point on the wall. Good for fault detection and for the ML's
  multi-sensor-agreement feature.

### 2.1 Coverage estimates for common excavation depths
| Excavation depth | Nodes per pipe | Sensors per pipe | RS485 bus length |
|---|---|---|---|
| 4 m  | 2  | 8  | ~2 m  |
| 6 m  | 3  | 12 | ~4 m  |
| 10 m | 5  | 20 | ~8 m  |
| 14 m | 7  | 28 | ~12 m |
| 20 m | 10 | 40 | ~18 m |
| 30 m | 15 | 60 | ~28 m |

RS485 is rated to ~1 km — even a 30 m dig is trivial for the bus. The
limiting factor is never RS485 length; it's install practicality (cable runs,
power distribution, number of boxes to mount).

### 2.2 Multiple pipes per site
A site can have several pipes (e.g., "North Wall," "East Wall," "South Wall")
— each an independent chain with its own gateway at the surface. Pipes don't
share an RS485 bus; each is its own bus. The backends ([BACKEND_SPEC](./BACKEND_SPEC.md))
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

- **Daisy-chained RS485** (A, B, GND) between adjacent node boxes, ~2 m per
  link (the node spacing).
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
  router) and its sensors cover the top 2 m of the wall (−1 m above surface
  to +1 m below — the top of the shoring).
- It runs the **full sensor brain** (it's a real sensor node for the top
  panel) **plus** the small relay module (poll slaves, POST to Supabase).
- Its long-press sets `is_gateway` and triggers global baseline capture.
- The gateway's own 4 sensors are real monitoring points, not wasted.

## 6. Install physical checklist (per pipe)

1. Mount node 1 (gateway) at the surface, centered on the top 2 m of wall.
2. Run 4 cat6 drops (≤1 m) to its 4 sensors; land S1/S3 right, S2/S4 left.
3. Mount node 2's box 2 m below node 1's box; wire its 4 sensors.
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

- **TCA + ESP32 centered**, 4 sensors splayed ±0.5 m / ±1.0 m, **max wire run
  1 m**.
- **Node span 2 m**, sensor density 1 per 0.5 m.
- **Nodes spaced 2 m center-to-center** vertically → seamless coverage +
  boundary redundancy.
- **Star wiring per sensor** (cat6 drops), **5 V local power**, **onboard
  pull-ups first**.
- **RS485 daisy-chain** between nodes, **120 Ω termination at both ends**.

## 8. Open / to-decide

1. **Power strategy:** local mains per box vs. single top-fed 5 V supply.
   Local mains is simpler and avoids deep-node voltage drop; top-fed is one
   fewer wall-wart per box. Pick based on what the site actually provides.
2. **Sensor-to-channel mapping convention** — confirm the S1=ch7, S2=ch3,
   S3=ch5, S4=ch1 suggestion (or pick your own) and label it at assembly so
   firmware's `SENSORS[]` matches the wires.
3. **Boundary overlap usage** — do you want adjacent nodes' boundary sensors
   explicitly compared in firmware (free cross-check), or just left as
   independent readings that the ML/server can correlate? Firmware-side is a
   small addition; server-side is the default.
