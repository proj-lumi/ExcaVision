# Continuation handover

## Status

The academic prototype was completed and presented. Hosted services are planned for retirement; check the actual provider dashboards rather than assuming URLs still work. Nothing in this archive automatically recreates provider resources, secrets, schedulers, Auth settings, or physical commissioning.

## Important limitations

### 1. Site completion, deletion, and reusable node inventory

A complete end-of-project lifecycle has **not** been designed or implemented. Current site archiving cascades to units and nodes; it is not the same as deleting a site or releasing hardware to inventory. There is no dedicated safe unassign/release workflow. Setup rejects nodes assigned to another unit, and archived nodes are not automatically reusable.

Before continuing, define a transactional site-closeout and node-release workflow: preserve historical readings and their original site/unit associations, stop acceptance of old telemetry, remove/revoke assignments safely, record an audit trail, and require physical reset/recommissioning before reassignment. Define separate retention, export, anonymization, and permanent-deletion policies for customer information and attachments. Do not present the reset/purge operator scripts as a finished product feature; they are destructive maintenance tools, not transactional lifecycle management.

### 2. Admin authentication and account lifecycle

Admin sign-in **does use Supabase Auth**, and the invitation API checks the caller's Admin role. It is not accurate to describe it as having no authentication. However, the project relies on a manually pre-provisioned/seeded Admin account, rather than a complete secure Admin onboarding and management lifecycle.

Do not reuse the demonstration password or a shared Admin account. Before public operation, implement controlled Admin provisioning/recovery, individual accounts, mandatory MFA, least privilege, session management, and security auditing. Review RLS and privileged functions independently. Never expose the server-only Supabase key in a public environment variable or browser bundle.

### 3. MAC-address spoofing

Gateway telemetry authentication currently trusts a registered MAC address supplied in `x-node-mac`. The telemetry Edge Function disables platform JWT verification and checks whether this MAC belongs to an assigned Gateway (Node 1). That is a registration check, **not cryptographic proof of device identity**.

Someone who learns a registered MAC can attempt to impersonate that Gateway. HTTPS does not stop a caller from claiming a MAC they know. Replace this with per-device credentials or signed requests, replay protection, secure provisioning, rotation/revocation, and server-side authorization binding the authenticated device to its current assignment. Evaluate command and baseline-recovery paths too. MAC values and project URLs are identifiers, not passwords.

### 4. Adding nodes and captive portal access

The RS-485 code periodically rediscovers nodes (`RS485_REDISCOVER_MS`), but portal access is a separate issue. The portal opens when saved Wi-Fi cannot connect; there is no dedicated non-destructive reopen-portal action on a normally connected Gateway. Merely toggling the Gateway role does not erase saved Wi-Fi. Add a controlled maintenance/commissioning mode before promising an easy physical expansion workflow.

A **10-second hold** or serial `r` clears state; on a Gateway this broadcasts reset to sensor nodes first. A **3-second hold** or serial `g` selects/deselects Gateway role, subject to the sensor-node guard. A brief press or `z` starts/cancels the 30-second baseline capture. EN/RST restarts without intentionally clearing saved settings. Resetting an installed unit is not a harmless way to view the portal.

The firmware map is S1/channel 7, S2/channel 3, S3/channel 5, S4/channel 1. That map alone does not prove the physical top-to-bottom wiring; verify the assembled hardware and label it before use.

### 5. Notification preferences

`MOBILE_APP_ORIGINS` must contain the exact PWA origin, without a trailing slash; otherwise preflight is rejected and the browser may report “Failed to send request to the edge function.” Production and staging origins belong in their respective Supabase projects.

The current PWA checks whether a browser push subscription exists, not whether it was successfully saved to the backend. A failed save can therefore leave the switch looking enabled. Follow-up work should reconcile browser and backend state and improve error reporting; this limitation is documented, not fixed in the archival cleanup.

### 6. Safety, calibration, and operational evidence

Validate sensor orientation, wiring, calibration/baseline capture, thresholds, offline behavior, fault reporting, and Gateway load with physical tests. Warning anomaly scores are independent of Critical thresholds. Avoid claiming reliability, predictive capability, certified accuracy, or hardware verification from source inspection alone.

## Restart sequence

1. Review the gaps above; secure identity and Admin access before public telemetry/intake.
2. Provision new staging resources, then populate the environment templates with newly issued credentials. Do not restore retired secrets.
3. Apply migrations to a fresh staging database in order; verify Auth redirects, RLS, Storage, Edge Functions, schedulers, email and CORS. Migrations do not restore all dashboard settings.
4. Provision an individual Admin account securely. The existing seed tool is only a bootstrap aid; it is not an Admin management system.
5. Build/test frontends on a capable host. Run the lightweight repository checks first.
6. Build the selected firmware environment, physically flash all intended devices, and commission/calibrate the assembled unit. Existing flashed firmware still points to its old backend until replaced.
7. Test site creation, repair/coverage requests, invitation activation, baseline recovery, readings, Critical/Warning events and push/email end-to-end in staging.
8. Only then create isolated production resources and repeat the configuration and acceptance checks.

No deployment, service deletion, credential revocation, or hardware flashing is performed by these notes.
