# ExcaVision App-Team Handoff

## 1. Architecture contract

The mobile app talks to **Supabase only**. It does not talk to ESP32 nodes,
RS-485, WiFi, or the node's secret key.

```text
App --publishable key + user JWT + RLS--> Supabase
ESP32 gateway --secret device key--> Supabase
ESP32 slaves --RS-485--> gateway
```

Never put `SUPABASE_SECRET_KEY` in the app. The app uses the Supabase
publishable/anonymous key and a logged-in user's JWT.

The app is a monitoring and administration interface. It does not calculate
tilt, run ML, or decide local buzzer alarms.

## 2. Current database hierarchy

```text
profiles -> sites -> pipes -> sensor_nodes -> sensors
                                             |
                         baselines, readings, alerts
```

Important tables:

- `profiles`: `id = auth.users.id`, `role`, `site_id`.
- `sites`: user-owned site.
- `pipes`: pipe name, site, and the engineer-controlled
  `alert_threshold_deg`.
- `sensor_nodes`: physical ESP32, `mac_addr`, position, gateway flag.
- `sensors`: four MPU6050 channels per node. Current channels are `7, 3, 5, 1`.
- `baselines`: baseline vector history, `captured_at`, `supersedes_id`.
- `readings`: recent 1-second data, retained for approximately 14 days.
- `readings_1min`: long-term downsampled data; the scheduled downsample job
  still needs to be implemented.
- `alerts`: threshold/model events, retained historically.
- `risk_scores`: future ML output; currently no ML service populates it.

The current test data uses:

```text
Master: 30:76:F5:E5:A2:24
Slave:  30:76:F5:E4:F6:CC
```

Do not hard-code these MACs in the app. Load them from Supabase.

## 3. Authentication and RLS

1. Sign in with Supabase Auth email/password.
2. Store the session securely using the platform's secure storage.
3. Use the user's JWT for all app requests.
4. RLS scopes data through `profiles.site_id`.
5. The app must not bypass RLS or use the service/secret key.

The app should verify that a user's profile exists after login. For testing,
a privileged setup step may be needed to create a `profiles` row linked to the
new Auth user and a test site.

Roles are intended to be:

```text
engineer | crew | inspector
```

- Engineer: edit pipe threshold, perform administrative actions.
- Crew: view live data and acknowledge alerts.
- Inspector: view history and incident records.

The current RLS migration has site-scoped policies, but engineer-only writes
must be verified/enforced in the backend before production. Do not rely only
on hiding a button in the client.

## 4. Threshold editing — important

`node_config` is a read-only database view. **Do not try to edit it.**

The source of truth is:

```sql
public.pipes.alert_threshold_deg
```

The app's engineer threshold form must update the selected pipe:

```sql
update public.pipes
set alert_threshold_deg = :new_threshold
where id = :pipe_id;
```

In the actual app, use the Supabase client update on `pipes`, not raw SQL.

After the update:

```text
pipes.alert_threshold_deg
  -> gateway detects it within about 15 seconds
  -> gateway broadcasts T;<deg> over RS-485
  -> every slave applies it to RAM and NVS
```

Show a small `syncing to nodes` or `last updated` state after saving. The
current node-side propagation latency is approximately 15 seconds; it is
polling, not an instant server push.

## 5. Baseline-period behavior

A new baseline starts a new monitoring period. The app must follow these rules:

- Never delete readings when a baseline is captured.
- Never delete old baseline rows.
- Keep old readings and alerts for history/audit purposes.
- The newest baseline for a sensor is the current baseline.
- By default, the current dashboard shows readings at or after that sensor's
  newest `baselines.captured_at`.
- Pre-reset readings remain available as a prior period labelled, for example,
  `Before baseline reset — 2026-...`.
- Alerts remain historical, including alerts from before a reset.
- Raw readings still follow the normal approximately 14-day retention policy.
- A baseline reset must not be displayed or learned as physical wall movement.

For the first app version, use the newest baseline's `captured_at` as the
period boundary. A per-reading `baseline_id` is not required yet.

## 6. Required MVP screens

### Login

- Email/password Auth.
- Secure session persistence.
- Clear signed-out/session-expired state.

### Site dashboard

For each pipe show:

- pipe name;
- OK/WARN/ALERT status;
- worst/latest tilt;
- current threshold;
- time of latest reading;
- gateway/node freshness indicator;
- unacknowledged alert count.

### Pipe detail

- Current-period live chart.
- One series per sensor.
- Threshold line.
- Per-node sensor tiles: tilt, `|g|`, temperature, `n/fail`, baseline status.
- Live/history toggle.
- Threshold editor for engineers.
- Alert shortcut.

Live data uses recent `readings`; historical data uses `readings_1min` once
that table is populated by the backend job.

### Node detail

Show:

- MAC address;
- position in pipe;
- gateway indicator, with the data-freshness caveat below;
- four sensors and their health values;
- latest baseline time/vector/status.

The app's `Re-zero baseline` button should be disabled or marked
`backend command not yet available` for now. The current firmware supports
physical-button global capture, but there is not yet an app-to-node command
queue/API for a remote re-zero.

### Alerts inbox

Each alert should show:

- timestamp;
- pipe;
- node MAC/position;
- sensor/channel;
- kind (`threshold` or `model`);
- severity;
- value;
- acknowledged state.

Use `alerts` as the authoritative alert event list. Do not infer event history
from `readings.alert_flag` alone.

### Install flow

The intended flow is:

1. Create/select site.
2. Create pipe.
3. Scan node MAC QR code.
4. Assign node position.
5. Verify nodes/readings appear.
6. Instruct the installer to set the gateway physically.
7. Instruct the installer to run global baseline capture physically.
8. Watch for baseline rows for all sensors.
9. Set the pipe threshold.

The app does not set the gateway flag; gateway selection is a physical button
action on the node.

## 7. Useful data queries

### Alerts with originating node

`alerts` stores `sensor_id`, so join through `sensors` and `sensor_nodes`:

```sql
select
  a.id, a.ts, a.kind, a.severity, a.value, a.acknowledged_at,
  n.mac_addr, n.position_in_pipe,
  s.channel, s.label
from public.alerts a
join public.sensors s on s.id = a.sensor_id
join public.sensor_nodes n on n.id = s.node_id
order by a.ts desc;
```

### Latest baseline per sensor

```sql
select distinct on (b.sensor_id)
  b.sensor_id, b.captured_at, b.bx, b.by, b.bz,
  n.mac_addr, n.position_in_pipe, s.channel, s.label
from public.baselines b
join public.sensors s on s.id = b.sensor_id
join public.sensor_nodes n on n.id = s.node_id
order by b.sensor_id, b.captured_at desc;
```

### Current-period reading rule

For each sensor, obtain its latest baseline timestamp and only use readings
where:

```text
reading.ts >= latest_baseline.captured_at
```

The backend may later expose this as a view/RPC to simplify the app query.

## 8. Realtime and freshness

Enable Supabase Realtime for the tables used by the app, especially:

- `readings`;
- `alerts`;
- optionally `sensor_nodes` for install/status updates.

The app should:

- load an initial query when a screen opens;
- subscribe to new rows while the screen is open;
- unsubscribe when leaving the screen;
- show `stale data — last update ...` when updates stop;
- never present cached data as live.

The current transport sends the gateway's own and slave readings to
Supabase. A slave alert reaches `alerts` through the master relay.

## 9. Known backend/firmware limitations to design around

1. **Downsampling job is not implemented yet.** Historical `readings_1min`
   data may be empty.
2. **Remote app baseline command is not implemented.** Physical baseline
   capture works; the app button must not pretend to send a command yet.
3. **Gateway status reporting needs verification.** The node's role is set by
   physical NVS state; do not treat a stale `sensor_nodes.is_gateway` value as
   definitive until the gateway heartbeat/report path is added.
4. **Alert acknowledgement notes are not in the current schema.**
   `acknowledged_at` exists; an optional note needs a future migration.
5. **Model risk scores are not populated yet.** Build an empty/coming-soon
   state for the risk panel.
6. **Engineer-only threshold writes need backend enforcement.** Confirm the
   role check in an RPC/policy before production.
7. **Realtime publication must be enabled/configured.** RLS still applies to
   Realtime rows.

## 10. Recommended app build order

```text
1. Supabase Auth + profile/site loading
2. Pipe/node/sensor hierarchy and RLS verification
3. Live pipe dashboard from readings
4. Alerts inbox and acknowledgement
5. Engineer threshold editor on pipes.alert_threshold_deg
6. Baseline status/history and current-period filtering
7. Install wizard
8. Realtime subscriptions, offline cache, freshness states
9. Risk panel once risk_scores exists
```

## 11. What to ask the firmware/backend team before production

- Confirm the final app environment variables and publishable key.
- Confirm engineer-only threshold update enforcement.
- Add/finish the gateway heartbeat so online status is authoritative.
- Add the scheduled `readings` → `readings_1min` job and 14-day cleanup.
- Decide how remote baseline commands will be queued and acknowledged.
- Add alert acknowledgement notes if required.
- Add push notification infrastructure for critical alerts.
