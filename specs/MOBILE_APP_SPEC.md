# Mobile App Spec — Shoring Monitor (engineer / site crew view)

> The app a logged-in user (engineer, site crew, inspector) uses to monitor
> their site's shoring in real time, review history, acknowledge alerts, and
> register new pipes/nodes at install time. Reads from the Supabase backend
> ([BACKEND_SPEC.md](./BACKEND_SPEC.md)); the node side is
> [NODE_SPEC.md](./NODE_SPEC.md); model risk scores come from
> [ML_SPEC.md](./ML_SPEC.md).

## 1. Purpose & users

A mobile app (React Native or Flutter — pick one; both talk to Supabase
natively) for the **human stakeholders** of a shoring site. Not for the
nodes; not for the ML. Three personas:

- **Engineer:** sets the alert threshold per pipe, reviews history, signs off
  on install.
- **Site crew:** watches the live dashboard during the work day, acknowledges
  alerts.
- **Inspector:** reviews historical data and incident logs after the fact.

All three are "users" in the backend sense (logged in, assigned to one site).

## 2. Information architecture

Five primary screens, organized around the hierarchy
(site → pipe → node → sensor):

```
Sites list (just the user's 1 site, for this scope)
  └─ Site dashboard  ← landing screen after login
       └─ Pipe detail (e.g., "North Wall")
            └─ Node detail (a single ESP32 box)
                 └─ Sensor detail (a single MPU6050)
```

Plus two cross-cutting screens: **Alerts inbox** and **Install wizard**.

## 3. Screens

### 3.1 Login
- Email + password (Supabase Auth). JWT stored securely.
- First-run: explain the app, request camera permission (for QR scanning at
  install).

### 3.2 Site dashboard (landing)
- One card per pipe at the user's site.
- Each pipe card shows:
  - Pipe name + status pill (OK / WARN / ALERT) — derived from the worst
    sensor's tilt vs threshold and the latest model risk score.
  - Latest tilt (max across the pipe's sensors), the threshold, and how close
    to it.
  - Gateway online indicator (is the master node reachable?).
  - Time of last reading.
- Tap a card → Pipe detail.
- Top bar: Alerts bell (badge = unacknowledged count), Install button.

### 3.3 Pipe detail (the main monitoring screen)
- **Live tilt chart** for the whole pipe: one line per sensor, x = time,
  y = tilt (°). Auto-refreshing (~1 s for the recent window from `readings`).
- The engineer-set threshold drawn as a horizontal red line on the chart.
  Any reading past it is a dot, not just a line.
- **Per-node strip** below the chart: each node's 4 sensors as small tiles
  showing `tilt` + `|g|` + `T` + `n/fail`, color-coded (green / amber / red
  by tilt vs threshold).
- **Risk panel:** the latest model risk score for the pipe (from
  `risk_scores`), as a gauge or a sparkline. "Normal" vs "departing from
  normal."
- Toggle: **live (1 s, last 24 h from `readings`) vs history (1 min, from
  `readings_1min`).** History lets you scroll back weeks.
- Buttons: "Set threshold" (engineer), "Acknowledge all alerts," "Export
  CSV."

### 3.3.1 The "two rates" in the chart
- Recent window (last 24 h, say): query `readings` (1 s) → smooth live chart.
- Older: query `readings_1min` (1 min) → long-term trend without flooding the
  app.
- The toggle is just which table the query hits. The backend's downsample job
  ([BACKEND_SPEC.md §5](./BACKEND_SPEC.md)) makes this cheap.
- **Baseline periods:** a re-zero starts a new monitoring period. Live/history
  charts show the **current period** by default — reading at/after the latest
  baseline's `captured_at`. Pre-reset readings are **never deleted**; they stay
  queryable and are labelled as a prior period ("before baseline reset @
  <time>"), so an engineer can review why a re-zero happened without
  mistaking the reset itself for movement.

### 3.4 Node detail
- A single ESP32 box: its MAC, position in pipe, `is_gateway` flag, online
  status.
- Its 4 sensors as bigger tiles: tilt, |g|, T, n/fail, baseline set? , last
  sample time.
- "Re-zero baseline" button (engineer only) — sends a command that triggers
  the node's SET action. (For the global capture, the installer does this
  physically with the button; this app button is for re-zero after re-mount,
  with a confirm dialog.)
- Health: |g| trend (should be ≈ 1.000), fail rate trend (should be ≈ 0).
  These catch a dying sensor or a degrading bus before it becomes a false
  alarm.

### 3.5 Sensor detail
- One MPU6050: full time-series of tilt + |g| + T, selectable ranges.
- Baseline info: when set, by whom, the baseline vector, supersedes history.
  A re-zero is shown as a **period boundary** — the prior period's readings
  remain available (labelled "before reset @ <time>"), never auto-deleted.
- Raw readings table (paginated) for forensics.

### 3.6 Alerts inbox
- List of `alerts` rows for the user's site, newest first.
- Each: time, pipe, node, sensor, kind (threshold / model-warning), severity,
  value, acknowledged?
- Tap → jump to the pipe detail scrolled to that time.
- "Acknowledge" action (engineer/crew) with optional note.
- Push notifications (via Supabase Realtime + a push service) for `severity =
  critical` so the crew doesn't have to watch the screen.

### 3.7 Install wizard (the Bob flow from BACKEND_SPEC §6)
A guided, step-by-step flow — this is what makes field install foolproof:

1. **"Create pipe"** — name it (e.g., "North Wall"), confirm the site.
2. **"Add nodes"** — for each physical box:
   1. Tap "Scan node QR" → camera scans the MAC QR → MAC auto-fills.
   2. Pick position (1/2/3/4 from the top).
   3. Tap "Add." Repeat for each box.
   (No gateway toggle here — the master is set by a physical button
   long-press on the box itself, outside the app. The app just records
   position.)
3. **"Review"** — show the pipe with its nodes; confirm.
4. **"Power on"** — instruct the crew to power the boxes; the app watches for
   each MAC to report in (via Supabase Realtime subscription on
   `sensor_nodes`/`readings`) and checks them off as they appear.
5. **"Settle & zero (physical step)"** — instruct: wait for the wall to
   settle (operational rule), then **long-press the top box's button for
   ≥3 s**. This is a physical action on the box, not in the app. The app
   watches for: (a) the top MAC to report `is_gateway: true`, and (b)
   baselines to arrive for each sensor — checks both off as they arrive. Pipe
   goes green when the gateway is set and all baselines are in.
6. **"Set threshold"** — engineer enters the alert threshold degrees for the
   pipe; backend stores it on `pipes` and pushes it to the nodes.
7. **Done** — monitoring live.

The wizard exists because install is the highest-risk moment for a safety
system (wrong MAC, wrong position, missing baseline → silent blindness).
Guiding it step-by-step with confirmation at each step is how you prevent
that.

## 4. Real-time mechanism

- **Supabase Realtime subscriptions** on `readings` and `alerts` for the
  user's site → new rows push to the app instantly (no polling). This is what
  makes the live chart feel live at 1 s.
- For the chart data itself, query the `readings` table on screen open + rely
  on Realtime for new rows while open. Paginate/decimate for the chart so 1
  row/sec doesn't render 3600 points/hour — downsample in the app for display.

## 5. Auth & security

- **User auth only** (Supabase Auth, JWT). No device keys in the app.
- **RLS** ensures the user sees only their site's data. The app doesn't
  enforce this; the database does. The app just queries and the database
  filters.
- **Install wizard actions** (create pipe, register node) are writes the
  user is permitted to do on their own site's rows.
- **Threshold setting** restricted to `role = engineer` (a column on `users`).

## 6. Offline / poor-signal behavior

Excavation sites have spotty signal on the surface. The app should:
- Cache the last-loaded pipe state for offline viewing (so the crew can still
  see "where was it last" if signal drops).
- Show a clear "stale data — last update X min ago" banner when Realtime
  hasn't delivered in N seconds.
- Queue "acknowledge alert" actions offline and sync when reconnected.
- Never silently show old data as if it were live.

## 7. What the app does NOT do

- It does not talk to nodes directly (no RS485, no Bluetooth). It talks to
  Supabase only.
- It does not compute tilt, features, or risk scores. It displays what the
  node and the ML service produced.
- It does not store baselines or thresholds locally — those are backend-owned.
- It does not run the model. It reads `risk_scores`.

## 8. Decisions to make before building

1. **React Native vs Flutter.** Both are fine. Pick whichever your team knows.
   Supabase has client libraries for both.
2. **Push notification service.** Supabase doesn't ship push; you'd add FCM
   (Android) + APNs (iOS) via a small cloud function triggered on
   `alerts` insert. Worth it for `severity = critical`.
3. **Chart library.** Pick a fast time-series chart lib (e.g.,
   `react-native-chart-kit`, `victory-native`, or a WebView + uPlot for heavy
   data). Must handle decimation for long ranges.
4. **Engineer role:** is there a separate `role` column on `users`
  (`engineer` vs `crew` vs `inspector`), or is everyone the same for v1? The
   threshold-setting permission depends on this.
