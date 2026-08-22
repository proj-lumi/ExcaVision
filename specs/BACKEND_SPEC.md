# Backend Spec — Supabase / Postgres

> The database that sits between the nodes and everything else (mobile app,
> ML). It stores **who owns what** and **what the sensors saw**. This spec
> captures the data model, the two auth systems, the install flow, and the
> storage tiers.
> Cross-refs: [NODE_SPEC.md](./NODE_SPEC.md),
> [MOBILE_APP_SPEC.md](./MOBILE_APP_SPEC.md), [ML_SPEC.md](./ML_SPEC.md).

## 1. Purpose

Two jobs:
1. **Ownership hierarchy:** user → site → pipe → sensor_node → sensor. Who
   owns what, resolved relationally.
2. **Time-series data:** the stream of tilt readings (and baselines, and model
   risk scores) that the nodes produce and the app/ML consume.

Everything else (dashboard, alerts, ML) just **reads** this database. The
database is the hub. Nodes write; humans and models read.

## 2. The hierarchy (nested boxes)

```
User (a person who logs in)
  └─ assigned to 1 Site
       └─ has N Pipes           (a pipe = a chain of sensor nodes)
            └─ has N Sensor Nodes    (one ESP32 box per position on the pipe)
                 └─ has 4 Sensors     (the MPU6050s on that box)
                      ├─ produces Readings   (the time-series)
                      └─ has 1 Baseline      (current zero reference)
```

Each child knows its parent (foreign key). To answer "does this pipe belong
to this user?" walk up: pipe → site → user. If the site is the user's site,
yes. That's the whole rule — pure parent pointers, enforced by foreign keys +
row-level security.

## 3. Tables

```sql
-- ownership
users          (id, email, password_hash, role, site_id, created_at)
sites          (id, name, lat, lon, created_at)
pipes          (id, site_id, name, installed_at, alert_threshold_deg)
sensor_nodes   (id, pipe_id, position_in_pipe, mac_addr, is_gateway, created_at)
sensors        (id, node_id, channel, label, created_at)

-- data
baselines      (id, sensor_id, captured_at, bx, by, bz, supersedes_id)
readings       (ts, sensor_id, tilt, g_mag, temp_c, n, fail, alert_flag)
readings_1min  (ts, sensor_id, tilt_mean, g_mag_mean, temp_c_mean, n_sum, fail_sum)
alerts         (id, ts, sensor_id, kind, severity, value, acknowledged_at)
risk_scores    (id, ts, node_id, predicted_tilt, actual_tilt, anomaly_score, model_version)
```

### 3.1 Key fields explained
- `users.site_id` — the 1 site this user belongs to (the "1 user → 1 site"
  rule, for this scope).
- `sensor_nodes.mac_addr` — the join key between the physical box and the
  database row. Unique. Set at install by scanning the box's QR label.
- `sensor_nodes.is_gateway` — `true` for the master box of each pipe. Only
  one per pipe. **Set by the node itself** (when its button is long-pressed
  and it next reports to Supabase), NOT set by the app/install wizard. The
  app reads this for display only.
- `sensor_nodes.position_in_pipe` — 1, 2, 3, … from the top. Set at install.
- `sensors.channel` — the TCA9548A channel (0–7) the sensor is on within its
  node. Together `(node.mac, sensor.channel)` uniquely identifies a sensor.
- `pipes.alert_threshold_deg` — the engineer-set tilt degrees that trips the
  alert. Pushed down to nodes; nodes cache it in NVS and check it locally
  every 1 s.
- `baselines.supersedes_id` — when a baseline is re-captured, the new row
  points at the old one. Baseline history is preserved (audit trail); the
  "current" baseline is the one with no row superseding it.
- `readings.alert_flag` — set by the node when it fired the local threshold
  alert for this reading. Lets the app show "this reading tripped the alarm"
  without a separate join.
- `risk_scores.model_version` — which model version produced this score
  (MLflow-style versioning). Lets you A/B models and roll back.

### 3.2 Identity resolution (how a reading finds its home)
A reading arrives as `(mac_addr, channel, tilt, ...)`. The backend:
1. Looks up `sensor_nodes WHERE mac_addr = …` → gets `node_id`.
2. Looks up `sensors WHERE node_id = … AND channel = …` → gets `sensor_id`.
3. Inserts into `readings` with that `sensor_id`.

The node never sends `sensor_id`, `node_id`, `pipe_id`, or `site_id` — it
sends only `(mac, channel)`. The database resolves the rest. This keeps the
node identity-light and the database identity-rich.

## 4. Two auth systems (do not confuse them)

### 4.1 User auth (humans, in the mobile app)
- A person logs into the app with email + password → Supabase Auth issues a
  **JWT**.
- Row-Level Security (RLS) policies enforce: a user can only see rows whose
  site ancestor matches `users.site_id`. Bob can't see Alice's sites.
- This lives entirely in the mobile app + Supabase Auth + RLS. The node has
  no part in it.

### 4.2 Device auth (nodes, in firmware)
- A node authenticates with a **device API key** (a secret string). v1: one
  shared service key stored in NVS across all nodes. v2 (optional): per-node
  keys provisioned at assembly.
- The device key permits **only** writing `readings`, `baselines`, `alerts`
  tagged with the node's own MAC, and reading its own `baselines` and
  `pipes.alert_threshold_deg`. It cannot read other nodes, see users, or
  delete anything.
- Enforced by RLS or a "device can only insert rows where `mac_addr =
  request.mac`" policy. The node is a narrowly-permitted machine credential.

**The node and the user never interact directly.** The node writes; the user
reads; the database mediates. Two separate auth domains, meeting in the
database.

## 5. Multi-resolution storage (the 1 s vs storage problem)

The monitoring app wants per-second live data; the ML and long-term history
only need per-minute; storing 1 s forever fills storage.

| Table | Resolution | Retention | Used by |
|---|---|---|---|
| `readings` | 1 s raw | ~14 days | live dashboard, recent ML features |
| `readings_1min` | 1 min means | forever | ML training, historical charts |
| `alerts` | event-based | forever | alert log |
| `risk_scores` | per inference (~1 min) | forever | dashboard risk panel, ML monitoring |

### 5.1 The downsample job
A daily scheduled job (SQL or Python cron):
1. `INSERT INTO readings_1min SELECT date_trunc('minute', ts), sensor_id,
   avg(tilt), avg(g_mag), avg(temp_c), sum(n), sum(fail) FROM readings WHERE
   ts < now() - interval '14 days' GROUP BY 1, 2 ON CONFLICT DO UPDATE.`
2. `DELETE FROM readings WHERE ts < now() - interval '14 days'.`

One `INSERT … SELECT … GROUP BY` + one `DELETE`. Beginner-buildable.

### 5.2 Storage math
- 1 row/sec/sensor × 4 sensors/node × 3 nodes/pipe ≈ 1 M rows/day raw.
- 14 days raw ≈ 14 M rows. Postgres handles this trivially.
- 1 min forever: ~17k rows/day, ~6 M/year, ~300 MB/year. Tiny.

## 6. Install flow (how a pipe gets assigned to a user)

1. **Assembly time (your team, before field):** flash each ESP32 with a
   "print my MAC" sketch, read the MAC, generate a QR code, print a label,
   stick it on the box. (10-line sketch + Python `qrcode` one-liner.)
2. **Install time (Bob in the field):**
   1. Bob logs into the app (user auth).
   2. Bob creates a pipe under his site: "North Wall." Backend creates a
      `pipes` row.
   3. For each box, Bob taps "scan node" → camera scans the QR → MAC
      auto-fills → Bob assigns position (1/2/3). Backend creates
      `sensor_nodes` rows (with `is_gateway` left false — the app does NOT
      set the gateway; that's a physical button action, see step 5).
   4. The backend auto-creates 4 `sensors` rows per node (channels 7, 3, 5, 1
      — matching the node's `SENSORS[]` table), or the node reports its
      channel list on first contact and the backend creates them.
3. **Power on:** boxes boot. Slaves wait for RS485 polls. The top box is
   **long-pressed** (see step 5) to become the master — only then does it
   connect WiFi, fetch its baseline (none yet → LED off), start polling
   slaves, and report `is_gateway: true` to Supabase (which updates its
   `sensor_nodes` row). The backend sees known MACs and starts accepting
   readings.
4. **Settle:** wall settles (operational rule: wait an hour or overnight after
   the dig finishes).
5. **Zero & set master:** the installer long-presses the top box's button
   (≥3 s) → that box becomes the gateway (NVS flag set) AND broadcasts
   "capture baseline now" down the RS485 chain → every box captures +
   uploads its 4 baselines tagged with its MAC (slaves via the master) →
   backend stores them under the right `sensors`. The master also reports
   `is_gateway: true` for itself. LEDs go solid. Monitoring begins.
   (This is a physical action by the installer, NOT a step in the app — it
   happens with a button on the box, outside the phone UI.)

The MAC is the handshake throughout. The box says "I'm …:…:…"; the database
already knows where that MAC lives because Bob registered it.

## 7. What the backend does NOT do

- It does not run the node firmware or compute tilt. Tilt is computed on the
  node; the backend stores it.
- It does not do user auth on the node's behalf. Device auth only.
- It does not run the ML. The ML is a separate Python service that **reads**
  `readings`/`readings_1min` and **writes** `risk_scores`. The backend just
  stores both.
- It does not decide alerts beyond the raw threshold (which the node already
  flagged). Model-based early warnings come from the ML service.

## 8. API surface (what the node calls)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/readings` | POST (batch) | device key | insert readings (array of rows, each tagged `mac, channel`) |
| `/baselines` | POST | device key | upload this node's baselines (on SET / global capture) |
| `/baselines?mac=…` | GET | device key | fetch this node's baselines (on boot / LOAD) |
| `/alerts` | POST | device key | push a priority alert (threshold tripped) |
| `/nodes/me/config` | GET | device key | fetch `alert_threshold_deg` for this node's pipe |

The mobile app uses Supabase's standard auth + RLS-protected endpoints for
everything it does (read pipes, read readings, register nodes, etc.) — those
are Supabase auto-generated CRUD, not custom.

## 9. Decisions locked

- **MAC as node identity**, QR-labeled at assembly, scanned at install.
- **Device key auth** for nodes (v1: shared). **User JWT + RLS** for the app.
- **1 s stream, 14-day raw retention, 1-min downsampled forever.**
- **`is_gateway` is a boolean on `sensor_nodes`**, reported by the node
  itself (originating from its button long-press → NVS → included in its
  Supabase posts), NOT set by the app. No auto-failover.
- **Baseline history preserved** (`supersedes_id`); current = unsuperseded.
- **Engineer-set threshold on `pipes`**, pushed to nodes, checked locally.
