# Mobile App Spec

The branded ExcaVision operational app talks **only to Supabase**. The
ExcaVision staff dashboard is specified separately in
[`ADMIN_DASHBOARD_SPEC.md`](./ADMIN_DASHBOARD_SPEC.md).

```text
App → publishable key + user JWT + RLS → Supabase
```

WiFi commissioning is a separate browser-based captive portal hosted temporarily
by the gateway. Never include the device secret in the app.

## Distribution

The public landing page does not advertise or link to an app download. The app
is available only after ExcaVision has reviewed the request, deployed the
customer's monitoring unit, and created the customer's account.

The primary customer app is a hosted PWA:

```text
ExcaVision deploys monitoring unit
        → staff creates customer account
        → private email invite to app.excavision.com
        → customer logs in and adds the PWA to the home screen
```

The PWA is the default distribution path for Android and iPhone. It can receive
web UI updates without requiring a store release, subject to browser support.

A Capacitor Android APK is an optional fallback for customers who need native
capabilities. It is distributed privately by email, not from the public landing
page. The APK shell should load versioned web bundles through a release manifest
so ordinary UI and data-flow updates do not require reinstalling the APK.

Native changes, such as new plugins, permissions, Bluetooth, background work, or
push-notification capabilities, still require a new native build. iOS native
builds require Apple-supported distribution, so the PWA remains the independent
path for iPhone customers.

## MVP screens

| Screen | Minimum content |
|---|---|
| Login | email/password and secure session persistence |
| My Site | active monitoring units, reading freshness, and current tilt |
| Dashboard | each monitoring unit's status, worst tilt, threshold, latest update |
| Monitoring Unit | live chart, threshold line, node/sensor tiles |
| Alerts | event list, direct delivery, and optional acknowledgement |

Alerts are evaluated and delivered directly to the customer's configured
contacts. ExcaVision personnel do not need to manually review every warning.
Acknowledgement records that the customer saw an alert, but does not delay or
block delivery.

Node/sensor details may be part of the Monitoring Unit screen for v1 instead
of separate screens.

## Coverage request workflow

The MVP links one customer account to one site through `profiles.site_id`.
Customers request monitoring coverage, not individual nodes. From **My Site**,
they can request repair or more coverage; ExcaVision may fulfill more coverage
with additional nodes or another monitoring unit.
The structured form asks about the area and coverage need; ExcaVision decides
node quantity and physical layout.

The request then enters the ExcaVision Service conversation. Staff can ask
follow-up questions and provide an estimate or proposal. The customer can
approve or request changes. Only after approval does ExcaVision create the
monitoring unit, deployment manifest, and field commissioning link in the admin
dashboard.

See [`SERVICE_REQUEST_SPEC.md`](./SERVICE_REQUEST_SPEC.md) for the form fields,
statuses, estimate rules, and one-week bounds.

## Linear app workflow

```text
Coverage request → ExcaVision proposal → admin manifest → field commissioning → customer monitoring
```

Physical commissioning happens in the responsive admin dashboard, using a
limited field link sent to the installer. The installer does not need a separate
mobile app.

### Customer first use

1. Log in; the assigned site and monitoring unit are already visible.
2. Monitor readings, charts, monitoring-unit status, and alerts.
3. Engineer users adjust the site threshold when needed.

Customers never enter MACs, claim nodes, select nodes, assign positions, or
perform installation.

### Ownership changes

If a node is sold or transferred, the buyer contacts ExcaVision through the
support form. An ExcaVision admin handles the reassignment through the admin
dashboard. The app never exposes ownership-transfer controls.

## Data rules

- Load hierarchy from `profiles → sites → pipes → sensor_nodes → sensors`.
- Derive request ownership from the authenticated session through `create_my_service_request`; never trust client-supplied profile or site IDs.
- Use recent `readings` for live data.
- Use `readings_1min` for history after downsampling exists.
- Use `alerts` as event history.
- Show stale-data time clearly; never present cached data as live.
- Subscribe to `readings` and `alerts` with Supabase Realtime while relevant
  screens are open.

## Baselines and thresholds

- Default charts to readings at or after each sensor's newest baseline.
- Keep older periods available; never delete them during re-zero.
- Engineers edit `pipes.alert_threshold_deg`, not the read-only `node_config`
  view.
- Show threshold updates as syncing; gateway polling can take about 15 seconds.
- Gateway selection and baseline capture are physical-button actions performed
  during field commissioning.

## Roles

- Engineer: edit the threshold for the assigned site.
- Crew: receive alerts and optionally acknowledge them.
- Inspector: review history when needed.

RLS must enforce permissions server-side.

## Current limitations

- `readings_1min` downsampling is not implemented.
- Remote baseline commands are not implemented.
- Gateway freshness/heartbeat needs verification.
- `risk_scores` is empty until ML exists.
- Push notifications are future work.

## Build order

1. Auth and site hierarchy.
2. Live monitoring-unit dashboard.
3. Alerts and acknowledgement.
4. Engineer threshold editor.
5. Baseline-period filtering.
6. Installer commissioning flow and Realtime polish.
