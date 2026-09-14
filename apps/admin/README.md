# ExcaVision Admin

Angular staff dashboard for the final October product.

## Included workflows

- staff email and password sign-in;
- operational overview using live database counts;
- service request review, map access, status updates, and guarded deletion;
- searchable approved-request selection and automatic site creation;
- site and monitoring-unit editing with dependency-safe deletion;
- manufactured-node registration and inventory editing;
- ordered node deployment with one gateway;
- modal-based forms and commissioning controls that do not shift page content;
- commissioning status and notes.

The responsive dashboard is also the field interface for ExcaVision staff during
installation. Customers never use this application.

## Security

The browser receives only the Supabase URL and publishable key. Every operation
uses the signed-in staff user's JWT and database RLS. Never place the Supabase
secret key in this application.

An approved account must have `role = 'admin'` in `public.profiles`. Bootstrap
the first admin manually in the Supabase SQL editor after creating the Auth user.

Apply the admin migrations through `0010_admin_guarded_crud.sql` before using
the app. Delete RPCs preserve historical sensor data by rejecting removal of
sites or monitoring units that still contain deployment records.

## Runtime configuration

The config script reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the
repository `.env`, or from the current process environment, and writes the
ignored file `public/config.js`.

`public/config.example.js` documents the browser-visible shape. Only public
Supabase values belong there.

## Develop

```bash
cd apps/admin
npm run start
```

## Build

```bash
cd apps/admin
npm run build
```

The production files are written to `apps/admin/dist/admin/browser/`.
