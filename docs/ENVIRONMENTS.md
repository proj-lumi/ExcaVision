# Production and staging configuration

Use **two different Supabase projects** and separate frontend deployments/keys. No staging operation should use the production project. Provisioning both hosted projects may consume free-tier allowances or incur charges; check provider limits before creating them. Supabase preview branching is optional and is not required by this repository.

## File architecture

For each directory below, copy `.env.production.example` to `.env.production` and `.env.staging.example` to `.env.staging`. Fill in fresh values, not the retired project's credentials. Real files are ignored; only `.example` templates are committed.

| Directory | Consumer |
|---|---|
| `apps/admin` | Nuxt Admin browser configuration and server-only invitation key |
| `apps/mobile` | Nuxt customer PWA public configuration |
| `apps/landing` | Astro public build configuration |
| `supabase` | Custom Edge Function secrets; explicit `--env-file` |
| `scripts` | Privileged maintenance and Admin-bootstrap tools |
| `firmware/node` | PlatformIO pre-build hook generating a header inside its environment-specific `.pio/build/` directory |

No implicit root `.env`, `.env.local`, or legacy `secrets.h` is required. Do not put a privileged key in `PUBLIC_*` or `NUXT_PUBLIC_*`; these values can enter browser code. Never flash a privileged key to an ESP32. Wi-Fi credentials are entered through the captive portal and stored on-device, not in these files.

Production copies of existing local credentials may remain ignored for private operator use; template or placeholder staging files are **not** a working staging environment. The hosted Supabase runtime does not read a file from your Git repository: secrets must be uploaded to the correct project.

## Required variables

Use the same variable names in each environment but different project URLs and private credentials. Replace the example origins and placeholder project references throughout.

### Admin — `apps/admin/.env.<environment>`

| Variable | Value / visibility |
|---|---|
| `NUXT_PUBLIC_SUPABASE_URL` | This environment's project URL; public |
| `NUXT_PUBLIC_SUPABASE_KEY` | Publishable or legacy anon key, never a service-role key; public |
| `NUXT_SUPABASE_SECRET_KEY` | Privileged secret/service-role key; server-only |
| `NUXT_INVITE_REDIRECT_URL` | This environment's PWA URL ending in `/invite`; server-only configuration |

The invitation handler uses this configured redirect, not a client-supplied alternate destination. Allowlist the exact invitation and password-recovery URLs in Supabase Auth settings for the selected project. Verify secure cookies, invitation activation, logout and recovery against the deployed origins.

### Customer PWA — `apps/mobile/.env.<environment>`

| Variable | Value / visibility |
|---|---|
| `NUXT_PUBLIC_SUPABASE_URL` | Same project URL as Admin; public |
| `NUXT_PUBLIC_SUPABASE_KEY` | Same project's publishable/anon key; public |
| `NUXT_PUBLIC_VAPID_KEY` | Must match backend `VAPID_PUBLIC_KEY`; public |
| `NUXT_PUBLIC_LANDING_URL` | This environment's Landing origin; public |

### Landing — `apps/landing/.env.<environment>`

| Variable | Value / visibility |
|---|---|
| `PUBLIC_SUPABASE_INTAKE_URL` | `<project URL>/functions/v1/submit-site-installation`; public |
| `PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare widget site key allowing the selected Landing hostname; public |
| `PUBLIC_ALLOW_UNVERIFIED_INTAKE` | Keep `false` for hosted staging and production |

### Backend — `supabase/.env.<environment>`

| Variable | Purpose |
|---|---|
| `TURNSTILE_SECRET` | Private Cloudflare widget verification secret |
| `ABUSE_HASH_SECRET` | Independent random private secret for intake abuse hashing |
| `PUBLIC_LANDING_ORIGINS` | Comma-separated exact Landing origins; no trailing slash |
| `ALLOW_UNVERIFIED_LOCAL_INTAKE` | Keep `false` in hosted environments |
| `ANOMALY_JOB_KEY` | Independent random private secret, also configured in the scheduler's `x-anomaly-job-key` header |
| `ANOMALY_SCORE_THRESHOLD` | Detector score cutoff; current default `0.70` |
| `ANOMALY_MIN_MOVEMENT_DEG` | Minimum movement guard; current default `0.5` |
| `ANOMALY_MIN_MOVEMENT_RATIO` | Threshold-relative movement guard; current default `0.2` |
| `VAPID_PUBLIC_KEY` | Public half of the Web Push key pair; copy to the PWA |
| `VAPID_PRIVATE_KEY` | Private half; backend only |
| `VAPID_SUBJECT` | Contact URI, e.g. `mailto:alerts@example.com` |
| `MOBILE_APP_ORIGINS` | Comma-separated exact PWA origins; no trailing slash |
| `RESEND_API_KEY` | Private email API key; required for critical-alert email |
| `ALERT_EMAIL_FROM` | Sender identity on a verified Resend domain |
| `ALERT_EMAIL_ORIGIN` | This environment's PWA origin used in alert links |
| `ALERT_EMAIL_LOGO_URL` | Public logo URL for email rendering |

Generate a separate VAPID pair with `node scripts/generate-vapid-keys.mjs`; its output includes a private key, so do not paste it in issues, logs, or commits. Generate independent random values for `ABUSE_HASH_SECRET` and `ANOMALY_JOB_KEY` using a cryptographically secure password/secret generator. Origin lists are strict allowlists, not wildcard URL patterns. An optional legacy `PUBLIC_LANDING_ORIGIN` fallback is still recognized, but the templates standardize on the plural variable.

Supabase injects `SUPABASE_URL` and legacy `SUPABASE_SERVICE_ROLE_KEY` for the current functions. **Do not upload `SUPABASE_*` entries as custom secrets**; the prefix is reserved. A fallback read of `SUPABASE_SECRET_KEY` remains in intake code for older setups, but it is not needed in these custom-secret files. When modernizing away from legacy keys, update all backend REST/auth headers together and verify the new key format end-to-end.

The anomaly scheduler/cron URL and job header must be configured separately per project; the environment file does not install a hosted scheduler. Recreate appropriate Auth email templates, verified sender/SMTP settings, Storage buckets/access rules and Auth redirect allowlists. Review how the migrations implement each before applying them to a new project.

### Operator tools — `scripts/.env.<environment>`

| Variable | Purpose |
|---|---|
| `SUPABASE_PROJECT_REF` | Selected project's 20-character reference |
| `SUPABASE_API_URL` | Must equal `https://<SUPABASE_PROJECT_REF>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Privileged server key; never share with the browser |
| `ADMIN_ONLY` | Keep `true` for Admin-only bootstrap; production rejects demo seeding |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME` | New individual Admin identity |
| `SEED_ADMIN_PASSWORD` | Fresh, strong private password; not the demo password |
| `SEED_DEMO_PASSWORD` | Only required when explicitly opting into staging demo customer records |
| `SEED_ADMIN_PHONE`, `SEED_DEMO_PHONE` | Optional schema-valid test/contact numbers supplied privately; default local demo phone is synthetic |

Local-only seed defaults are not production credentials. The seed script supports additional optional overrides (`SEED_DEMO_DOMAIN`, `SEED_ADMIN_PROFILE_ID`); normal restoration does not need them. Bare `node supabase/seed.mjs` is for the local development database. For hosted Admin bootstrap use `node supabase/seed.mjs --environment staging --allow-hosted-seed` only after reviewing the target, with `ADMIN_ONLY=true`. Production additionally rejects `ADMIN_ONLY=false`.

Maintenance scripts require `--environment staging` or `--environment production`; there is no implicit hosted target. Inspect first with `node scripts/reset-production-backend.mjs --environment staging --dry-run`. Actual deletion additionally requires `--confirm-staging` (or `--confirm-production`) and `--project-ref <matching-ref>`. The legacy filename is retained but does not force production. Purge uses the same safeguards plus `--customer <email>`. **These are destructive, non-transactional tools**; power nodes down, back up authorized data, and review the plan before confirming.

CLI credentials such as `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and Cloudflare API tokens belong in the operator's secure shell/CI secret store, not in frontend files or the custom Edge Function secret file. They are not application runtime variables.

### Firmware — `firmware/node/.env.<environment>`

Only `SUPABASE_URL` is needed. It is a public project URL, not device authentication. PlatformIO uses the selected environment to generate `Environment.generated.h` inside that environment's build directory. Old `include/secrets*.h` files are ignored and no longer read. Staging is the default PlatformIO target; always specify `-e` deliberately. Environment files accept simple `KEY=value` lines; shell interpolation is not supported.

Build with `pio run -e staging` or `pio run -e production` from `firmware/node`. Uploading/flashing is a separate action. Switching URLs requires reflashing and physical verification; it does not change the firmware already installed on hardware. Do not assume an old saved baseline or assignment is valid for a different backend.

## Build and deployment selection

Inside each frontend app:

- `npm run dev` uses staging configuration.
- `npm run build:staging` / `npm run build:production` select the build environment.
- Nuxt apps also support `npm run typecheck:staging` / `npm run typecheck` (production).
- `npm run preview:staging` / `npm run preview` preview the previously built output. A preview cannot convert a production browser bundle into a staging one; build the correct target first.

Astro uses `--mode`; Nuxt uses `--dotenv`. Shell/CI values can override file values in framework tooling, so do not mix production shell secrets with staging commands. Astro/Vite also loads base `.env` / `.env.local` files if present; do not create those ambiguous files in this architecture. Nuxt public values and the static Landing values require a rebuild when changed. Private Nuxt runtime secrets must be available in the corresponding Cloudflare deployment environment as well; do not assume a local env file configures remote runtime secrets.

Use **distinct Cloudflare Pages projects** for production and staging, and set the corresponding per-project build/runtime variables. The checked-in Wrangler names are base names, not automatic environment isolation. When deploying manually, specify the correct Pages project explicitly (`--project-name`) and verify that project's runtime secrets and custom domain. Never upload staging `dist` output to the production project. Retired domains must be replaced in any remaining hard-coded branding/email HTML before relaunch.

From the repository root, after configuring the file, local configuration checks are network-free:

```sh
node scripts/check-environment.mjs staging
```

For Supabase, explicitly select both the secret file **and the matching project**. These commands change hosted state; inspect the project reference before running them:

```sh
supabase secrets set --env-file supabase/.env.staging --project-ref <staging-project-ref>
supabase functions deploy --project-ref <staging-project-ref>
```

For production, use `supabase/.env.production` and the production project reference instead. Do not rely on whichever project was last linked. Local function development reads the selected file with `supabase functions serve --env-file supabase/.env.staging`; the built-in Supabase URL/key then point at the local stack, not the hosted staging database. Keep local frontend URLs aligned with that local stack if testing locally.

Database migrations need a separately verified project link or database URL. Discover the installed CLI's exact flags with `supabase db push --help` and `supabase link --help`; confirm the target before any schema change. None of the archival setup commands deploys or resets a database automatically.

## Lightweight verification

Run `node --test scripts/tests/*.test.mjs` and `python -m unittest discover -s firmware/node/tests -p 'test_*.py'`. Configuration checks validate required values, project agreement, VAPID matching, origin lists and accidental privileged keys in public variables. They do not validate external key permissions, provider resources, email delivery, browser push, physical wiring, or a live deployment.
