# ExcaVision

IoT excavation monitoring with distributed tilt sensors, Gateway telemetry, anomaly detection, and real-time web monitoring.

Completed and presented as an academic project. This repository preserves the source and handover documentation; the original hosted services are intended to be retired. A working public demo is not promised.

**Prototype only:** not a certified geotechnical instrument or a substitute for professional assessment, inspection, or a safety system. Review the documented security gaps before deploying it again.

## Components

| Component | Stack | Location |
|---|---|---|
| Public installation requests | Astro, Turnstile | `apps/landing` |
| Admin review, commissioning, invitations | Nuxt, Nuxt UI | `apps/admin` |
| Customer monitoring PWA | Nuxt, Nuxt UI, ECharts, Web Push | `apps/mobile` |
| Sensor nodes and Gateway | ESP32, MPU6050, TCA multiplexer, RS-485, PlatformIO | `firmware/node` |
| Data, access policies, intake, telemetry and events | Supabase Postgres, Auth, Storage, Edge Functions | `supabase` |
| Shared types | TypeScript | `packages/domain` |

The Gateway polls sensor nodes over RS-485 and uploads readings over Wi-Fi. Critical alerts come from sustained fixed-threshold exceedances; separate Isolation Forest advisories indicate unusual readings. Customers can view readings, health, events, and notification preferences.

## Start here

- [Environment setup and complete variable inventory](docs/ENVIRONMENTS.md)
- [Continuation notes and known limitations](docs/HANDOVER.md)
- [Credential revocation and service shutdown checklist](docs/RETIREMENT.md)
- [WBS-to-code presentation guide](docs/WBS.md)

Use separate Supabase projects, deployment targets, and credentials for **production** and **staging**. Each component has `.env.production.example` and `.env.staging.example`; copy them to the corresponding ignored `.env.production` / `.env.staging` files and supply fresh values. There are no usable credentials in the templates. Environment files alone do not provision services.

Frontend development defaults to staging. Build with `npm run build:staging` or `npm run build:production` inside the selected app. Firmware uses `pio run -e staging` or `pio run -e production` in `firmware/node`; flashing is a separate physical action. See the environment guide before running either.

Mock JSON contains synthetic display data, not customer records. Phone placeholders are deliberately non-dialable and are not valid database seed input. The separate demo seeder is opt-in and must not be used to populate production with demo customers.

## Repository history

The current history is a **current-dated reconstruction grouped by manuscript WBS**, not the original development timeline. Shared foundations precede the five module snapshots. Modules span several files and layers; a snapshot's file grouping does not imply exclusive ownership or an independently deployable intermediate revision. The temporary private backup of the original history and unsanitized material was deleted at the team's request after reconstruction.

## License

[MIT](LICENSE), copyright 2026 ExcaVision Project Team. Third-party dependencies and bundled assets retain their own licenses; see [third-party notices](docs/THIRD_PARTY.md).
