# ExcaVision Customer PWA

Private Ionic Angular monitoring app for invited customers. It is not linked from the public landing page.

## MVP flow

1. Staff commissions at least one monitoring unit.
2. Staff opens **Sites** in Admin and sends the customer invitation.
3. The customer follows the private `/auth/confirm` link and creates a password.
4. RLS limits the dashboard, readings, alerts, and service history to `profiles.site_id`.
5. Repair and more-coverage requests are created by `create_my_service_request`; customer and site identifiers come from the authenticated session.

## Local configuration

Copy `.env.example` to `.env` and set the public Supabase values. `npm start` and `npm run build` generate ignored `public/config.js` automatically.

The invitation Edge Function also needs:

- `CUSTOMER_APP_URL`, for example `https://app.excavision.com`
- `ADMIN_SITE_ORIGINS`, a comma-separated allow-list for Admin

Start locally with `npm start`. Production builds include Angular's service worker and `manifest.webmanifest`. The Supabase Realtime client is dynamically imported only after a monitoring screen opens.

Capacitor remains deferred until a native-only need is confirmed.
