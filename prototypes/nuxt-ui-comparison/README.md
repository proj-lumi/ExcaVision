# ExcaVision Nuxt UI comparison prototype

A frontend-only comparison build for evaluating whether Nuxt UI gives the team a faster, more maintainable interface workflow than the current Angular implementations.

## Included

- Admin overview, requests, installations, inventory, and sites
- Customer PWA dashboard, alerts, service requests, manifest, and service worker
- Local JSON state only; no Supabase or device connection
- Nuxt UI controls and surfaces; custom CSS is limited to application layout

## Run

```bash
npm install
npm run dev
```

Open:

- `/admin` for the staff dashboard
- `/app` for the customer PWA

Changes reset when the browser session is refreshed. Nothing is written to a backend.
