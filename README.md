# ExcaVision

ExcaVision is organized as a small product repository. Each deployable surface owns its build configuration and source tree. The October MVP serves Philippine monitoring sites only and is the final releasable product for this project. Here, MVP means the smallest complete product that can operate without relying on a later phase. The team is iterating on ideas and validating execution, not building a disposable prototype.

## Repository layout

```text
apps/
  landing/       Astro public site and service-request entry point
  admin/         Staff dashboard implementation
  mobile/        Ionic customer app implementation
firmware/
  node/          PlatformIO ESP32 production firmware
  lab/           Reserved for hardware test sketches
supabase/        Database migrations, configuration, and seed data
specs/           Product, backend, firmware, and physical-build decisions
archive/         Superseded experiments kept for reference
```

## Landing page

```bash
cd apps/landing
npm run dev
```

Production build:

```bash
cd apps/landing
npm run build
```

The generated static site is written to `apps/landing/dist/`.

## Admin dashboard

```bash
cd apps/admin
npm run start
```

Apply `supabase/migrations/0007_final_admin_dashboard.sql` before signing in.
See `apps/admin/README.md` for staff-account and runtime-config setup.

## Node firmware

```bash
cd firmware/node
pio run
```

Upload to a connected board by adding the required upload target and port from `specs/NODE_SPEC.md`.

## Backend

Supabase remains at the repository root because it serves the landing, admin, mobile, and firmware surfaces.
