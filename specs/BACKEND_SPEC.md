# Backend Spec

Supabase is the hub between nodes, the app, and future ML. The implemented
schema is authoritative in `supabase/migrations/`.

## Data model

```text
manufactured_nodes ──deploys as──→ sensor_nodes → sensors
         │                              │
         └→ assigned site       readings, baselines, alerts

profiles → sites → pipes → sensor_nodes
sensor_nodes → risk_scores
```

Key identity rule: firmware sends `(mac, channel)`; backend RPCs resolve it to
a sensor row.

| Data | Purpose |
|---|---|
| `manufactured_nodes` | producer registry per sold node: unique MAC identity, generated legacy serial label, assigned site/pipe, position, deployment state |
| `pipes.alert_threshold_deg` | pipe-level threshold source of truth |
| `sensor_nodes.mac_addr` | deployed physical node identity |
| `baselines` | complete baseline history |
| `readings` | one-second measurements |
| `readings_1min` | future long-term downsample |
| `alerts` | historical threshold/model events |
| `risk_scores` | future ML output |

## Manufacturing and ownership

- Producers register every node individually using the service role.
- MAC addresses are uppercase canonical values such as `AA:BB:CC:DD:EE:FF`.
- Before delivery, the producer/admin assigns each sold node to a customer site
  and creates the deployment manifest: pipe, position, and gateway role. A pipe
  groups nodes; it is not the sold inventory unit.
- The producer deploys each assigned node before handoff; deployment creates
  the `sensor_nodes` and four channel rows.
- The installer may verify the manifest and commission the deployment, but cannot
  change ownership, pipe position, or gateway assignment.
- `profiles.site_id` plus `pipes.site_id` is the app user's ownership boundary.
  RLS exposes only nodes/readings in that site.
- Customers never enter a MAC, scan a node QR, claim a node, select nodes, or
  assign positions. A reassignment is a producer/support operation per node.
- When the gateway checks in, its MAC must already exist as an assigned/deployed
  node; unknown MACs do not become customer-owned automatically.

## Node interface

Nodes use the secret device credential; never expose it in the app.

| RPC/view | Purpose |
|---|---|
| `insert_readings(batch)` | insert a tagged reading batch |
| `upsert_baseline(...)` | append a baseline and link its predecessor |
| `get_current_baselines(mac)` | recover newest baselines |
| `insert_alert(...)` | insert a priority alert |
| `node_config` | read the pipe threshold by MAC |
| `deploy_manufactured_node(...)` | producer-only: deploy one preassigned node into its pipe |
| `sensor_nodes.position_in_pipe` | ordered chain position shown to the installer |
| `sensor_nodes.is_gateway` | the upstream gateway node; exactly one per pipe |

## App security

- App uses the Supabase publishable key plus the signed-in user's JWT.
- RLS scopes rows through `profiles.site_id`.
- Never ship `SUPABASE_SECRET_KEY` in the app.
- Engineer-only threshold writes still need backend enforcement; hiding the
  button is not security.

## Baseline rule

Re-zero never deletes data. The newest baseline's `captured_at` starts the
current monitoring period. App and ML must not compare across that boundary.

## Retention target

- Keep one-second `readings` for about 14 days.
- Downsample to `readings_1min` before deleting old raw rows.
- Keep baselines and alerts historically.

## Remaining backend work

- Build the producer-only inventory/fulfillment interface for registering
  nodes, assigning/reassigning nodes, deploying them into pipes, and retiring
  units.
- Implement and schedule downsampling/cleanup.
- Enforce engineer-only threshold changes.
- Verify gateway heartbeat/status updates.
- Configure Realtime publication.
- Add remote command infrastructure only if remote baseline capture is needed.
