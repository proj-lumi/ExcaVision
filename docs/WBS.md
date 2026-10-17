# Manuscript WBS → code

Modules describe behavior, not folders. A shared store, migration or endpoint can implement more than one module. In particular, **request submission is WBS 2.0; Admin review/approval is WBS 3.0**. Account activation belongs to WBS 6.1, although it completes an invitation initiated by WBS 3.3.

## Brief presentation files

Each row is a concrete file you can open; multiple rows are intentional where one file cannot represent both flows.

| Module | File | Show briefly |
|---|---|---|
| **2.0 Manage Requests** | `apps/landing/src/pages/index.astro` | Public installation form |
| **2.0 Manage Requests** | `apps/mobile/app/components/CoverageRequestModal.vue` | Existing-customer requests for more nodes or another unit |
| **2.0 Manage Requests** | `apps/mobile/app/pages/unit/[id].vue` | `submitRepair` and the repair dialog |
| **3.0 Set Up Sites** | `apps/admin/app/pages/requests.vue` | Admin review, approval and rejection |
| **3.0 Set Up Sites** | `apps/admin/app/pages/setup/[id].vue` | Commissioning workflow and invitation readiness |
| **4.0 Process Readings** | `firmware/node/src/main.cpp` | Main sensing/control loop and Gateway coordination |
| **5.0 Generate Events** | `firmware/node/src/hardware/Alarm.cpp` | Sustained threshold Critical alarm logic |
| **5.0 Generate Events** | `supabase/functions/detect-anomalies/index.ts` | Isolation Forest Warning/advisory generation |
| **6.0 Monitor Sites** | `apps/mobile/app/pages/index.vue` | Customer monitoring overview |
| **6.0 Monitor Sites** | `apps/mobile/app/pages/unit/[id].vue` | Current readings, health and threshold control |

Search `WBS 2.0` through `WBS 6.0` for selected entry-point comments. These markers are navigation aids, not a claim that all code is in one file.

## Detailed traceability

Paths below are relative to the repository root. This is a navigation guide, not proof that every manuscript requirement is fully implemented or validated.

| WBS | Main implementation files |
|---|---|
| **2.1 Submit Request** | `apps/landing/src/pages/index.astro`; `supabase/functions/submit-site-installation/index.ts` |
| **2.2 Request Service** | `apps/mobile/app/components/CoverageRequestModal.vue`; `apps/mobile/app/pages/unit/[id].vue` (`submitRepair`); `apps/mobile/app/composables/useCustomerStore.ts` (`submitCustomerRequest`); `apps/mobile/app/components/RequestAttachments.vue` |
| **3.1 Review Requests** | `apps/admin/app/pages/requests.vue`; `apps/admin/app/composables/useAdminStore.ts`; `supabase/migrations/20260928075655_approve_request_resources.sql` |
| **3.2 Set Up Units** | `apps/admin/app/pages/setup/[id].vue`; `apps/admin/app/components/SetupPacketModal.vue`; `firmware/node/src/connectivity/Cloud.cpp`; `firmware/node/src/connectivity/Rs485.cpp` |
| **3.3 Invite Customers** | `apps/admin/app/components/InviteUserModal.vue`; `apps/admin/server/api/admin/invite.post.ts`; `apps/admin/app/pages/setup/[id].vue` |
| **4.1 Read Sensors** | `firmware/node/src/sensing/MPU6050.cpp`; `firmware/node/src/sensing/Report.cpp`; `firmware/node/src/main.cpp`; `firmware/node/include/Config.h` |
| **4.2 Capture Baselines** | `firmware/node/src/sensing/Baseline.cpp`; `firmware/node/src/hardware/Button.cpp`; `firmware/node/src/main.cpp` |
| **4.3 Send Readings** | `firmware/node/src/connectivity/Rs485.cpp`; `firmware/node/src/connectivity/Sender.cpp`; `firmware/node/src/connectivity/Cloud.cpp`; `supabase/functions/node-telemetry/index.ts` |
| **4.4 Control Nodes** | `firmware/node/src/main.cpp`; `firmware/node/src/hardware/Button.cpp`; `firmware/node/src/hardware/Led.cpp`; `firmware/node/src/system/TestingReset.cpp` |
| **5.1 Check Thresholds** | `firmware/node/src/hardware/Alarm.cpp`; `supabase/functions/node-telemetry/index.ts`; `supabase/migrations/20260921093644_deduplicate_open_threshold_alerts.sql` |
| **5.2 Detect Anomalies** | `supabase/functions/detect-anomalies/index.ts`; `supabase/migrations/20260916204140_isolation_forest_pipeline.sql`; `supabase/migrations/20260921130325_deduplicate_open_anomaly_events.sql` |
| **6.1 Manage Accounts** | `apps/mobile/app/pages/invite.vue`; `apps/mobile/app/pages/confirm.vue`; `apps/mobile/app/pages/login.vue`; `apps/mobile/app/pages/settings.vue`; `apps/mobile/app/pages/forgot-password.vue`; `apps/mobile/app/pages/reset-password.vue` |
| **6.2 View Sites** | `apps/mobile/app/pages/index.vue`; `apps/mobile/app/pages/units.vue`; `apps/mobile/app/pages/unit/[id].vue`; `apps/mobile/app/composables/useCustomerStore.ts` |
| **6.3 View Readings** | `apps/mobile/app/pages/unit/[id].vue`; `apps/mobile/app/pages/trends.vue`; `apps/mobile/app/components/TrendChart.client.vue` |
| **6.4 View Health** | `apps/mobile/app/utils/presentation.ts`; `apps/mobile/app/components/UnitStatusSummary.vue`; `apps/mobile/app/pages/unit/[id].vue` |
| **6.5 View Events** | `apps/mobile/app/pages/alerts.vue`; `apps/mobile/app/utils/alerts.ts`; `apps/mobile/app/utils/advisories.ts` |
| **6.6 Receive Notifications** | `apps/mobile/app/composables/usePushNotifications.ts`; `apps/mobile/app/pages/settings.vue`; `apps/mobile/public/sw.js`; `supabase/functions/push-subscriptions/index.ts`; `supabase/functions/_shared/push.ts` |
| **6.7 Set Thresholds** | `apps/mobile/app/pages/unit/[id].vue`; `apps/mobile/app/composables/useCustomerStore.ts` (`updateThreshold`); `firmware/node/src/connectivity/Sender.cpp` (configuration synchronization) |

Database definitions span multiple ordered migrations. Inspect later replacements/hardening of a function, not just its first definition. The domain types and migration sequence support all modules.

## Reconstructed commit grouping

1. **Shared foundations:** domain contracts, ordered database migrations, repository configuration, environment tooling/tests, and safe operator scripts. Shared SQL is kept together rather than arbitrarily split into an invalid migration sequence.
2. **WBS 2.0 — Manage Requests:** Landing intake, public intake function, customer coverage/request attachments, and the shared customer store/unit page containing repair submission. Those shared customer files also implement WBS 6.0 behavior.
3. **WBS 3.0 — Set Up Sites:** Admin UI, review/approval, hardware registration/setup, invitations and Auth email templates.
4. **WBS 4.0 — Process Readings:** firmware sensing, baselines, RS-485, cloud transport, node controls and telemetry ingestion. Telemetry ingestion also persists WBS 5.0 events.
5. **WBS 5.0 — Generate Events:** threshold alarm implementation, anomaly detector and shared event push/email delivery.
6. **WBS 6.0 — Monitor Sites:** remaining PWA monitoring/account/health/chart/event UI, service worker, push-preference endpoint and browser subscription management.
7. **Archive handover:** README, MIT license, WBS map, environment inventory, security limitations, retirement and third-party notices.

These are honest, current-dated source snapshots reconstructed after presentation. They are not fabricated historic milestones, and intermediate commits are not promised to build independently. All final-tree source is preserved except the explicitly sanitized data and obsolete credential-header examples. No original history or unsanitized fixtures are retained as reachable branches/tags in the new local Git database.
