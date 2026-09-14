# ExcaVision Landing

Astro static site for public product information and new-installation onboarding.

## Commands

```bash
npm run dev
npm run build
npm run preview
```

The October landing flow serves Philippine locations only. The location picker uses Leaflet with OpenStreetMap tiles, Philippines-bounded map navigation, and debounced Nominatim suggestions restricted to the Philippines. Visitors must provide an approximate location; survey permission is handled by ExcaVision Service afterward. The hero currently contains a labeled photo placeholder. Replace it with a real documentary site photograph before launch.

Public installation submissions are validated by the `submit-service-request` Supabase Edge Function and stored in `public.service_request_intakes` for staff review. They do not enter the canonical work queue until an admin accepts them. Repair and more-coverage requests belong in the authenticated customer PWA.

Set the public `TURNSTILE_SITE_KEY` at build time. The Edge Function requires `TURNSTILE_SECRET_KEY`, checks the `installation_request` action, and fails closed in production. `PUBLIC_SITE_ORIGINS` restricts callers, `TURNSTILE_ALLOWED_HOSTNAMES` restricts verified widget hosts, and `RATE_LIMIT_SALT` protects stored IP hashes. Atomic database checks enforce email, IP, and duplicate-fingerprint limits. Local development may explicitly set `ALLOW_UNVERIFIED_LOCAL_INTAKE=true`; never enable that bypass for a public origin.
