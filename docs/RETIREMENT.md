# Credential revocation and service retirement

The only intended remaining public resource is the GitHub source repository. This is a checklist, **not a record of completed shutdown**. No credentials have been revoked and no hosted resources have been removed by the archival work.

## Rotate/revoke or permanently retire

Private values are deliberately not printed here. Production and staging each need separate treatment, if both were deployed.

| Credential | Where it was used | Retirement action |
|---|---|---|
| Supabase privileged secret / legacy `service_role` key | Admin `NUXT_SUPABASE_SECRET_KEY`; operator `SUPABASE_SECRET_KEY`; injected `SUPABASE_SERVICE_ROLE_KEY` | Revoke modern secret keys in project settings. Legacy keys may require JWT-secret/signing-key migration; deleting the entire project also retires its API. Do not confuse this with rotating a publishable key. |
| Supabase database password / connection URLs containing it | SQL tools, CLI, migrations, possibly provider/CI secrets | Rotate if the database remains; delete the project for permanent retirement. Remove stored connection strings. |
| Supabase personal/access tokens | CLI and any GitHub deployment secrets | Revoke project-specific tokens; review scopes of shared tokens before rotating them. |
| Admin and test/customer passwords and sessions | Supabase Auth / seed provisioning | Delete retired accounts and sessions. Change any password reused elsewhere. Do not preserve a working shared Admin account. |
| `ANOMALY_JOB_KEY` | Detector function, scheduler/cron request headers and possibly database Vault | Retire/rotate; disable its scheduler and remove Vault/cron copies. |
| `ABUSE_HASH_SECRET` | Public-intake abuse hashing | Retire/rotate; do not publish hashed personal data or restore the old secret. |
| `TURNSTILE_SECRET` | Cloudflare Turnstile and intake function | Delete the project widget or rotate its secret if retained. |
| `VAPID_PRIVATE_KEY` | Backend Web Push signer | Destroy the old private key and saved push subscriptions; generate a new pair on restart. Remove the matching public key from retired builds. |
| `RESEND_API_KEY` | Critical-alert email delivery; possibly Auth SMTP configuration | Revoke the API key; remove project-specific SMTP credentials/settings and sender integrations. |
| Cloudflare API tokens / project-specific global-key use | Pages/Wrangler/DNS/Turnstile deployment | Revoke scoped tokens. If a global API key was exposed, rotate it after checking unrelated services. Clear Wrangler OAuth authorization if project-specific access is no longer needed. |
| GitHub PATs, deploy keys, Actions credentials | Deployment or repository automation, if configured | Remove project-specific credentials and environment/repository secrets. Keep normal repository access; do not delete a shared SSH identity solely because this project used Git. |
| Site Wi-Fi passwords | ESP32 saved NVS and physical installer devices | Reset/erase retired nodes securely. Change the network password if it was shared or exposed; do not disrupt unrelated networks without approval. |

**Not private keys:** Supabase URLs/project references, publishable/anon keys, Turnstile site keys, VAPID public keys, MAC addresses, domains and email sender addresses. They are not proof of device identity. Retire the corresponding resources and remove obsolete builds anyway. Revoking a GitHub/Supabase access token is different from deleting a local `.env` file.

Some provider credentials above may only exist in CLI key stores, dashboard settings, environment variables, or CI—not in the checkout. This is a provider-by-provider review list, not a claim that every credential was found locally.

## Shutdown checklist

1. Save only the private exports and hardware records that the team is authorized to retain. Respect participant/customer consent and retention limits; never put those exports in the public repository.
2. Power off Gateways/sensor nodes. Disable anomaly schedules/cron and other jobs, then revoke project-specific automation access so traffic and costs do not resume.
3. Remove the three frontend deployments (Admin, PWA, Landing), including old previews, environment secrets, logs, deployment artifacts and custom-domain associations. Uninstall the PWA/unregister its service worker on test devices; deletion of a website does not erase a browser's cached copy.
4. Delete the Supabase project(s), including databases/Auth/Storage/Functions, after any authorized exports. Check backup retention and billing in the dashboard. Deleting records is not equivalent to deleting the hosted project.
5. Delete Turnstile widgets, Resend keys/project sender integrations, project-specific cron/workers, tunnels, and related monitoring integrations. Review Resend/provider retention of email/contact logs.
6. Remove project DNS records and release/cancel project-only domains or subscriptions when appropriate. Never remove an unrelated domain, shared account, or shared provider resource. Beware of orphaned custom-domain records pointing at deleted hosting projects.
7. Reset/erase hardware NVS (roles, Wi-Fi, baselines); unplug or reflash firmware so it no longer attempts to reach retired URLs. A physical full reset is not a cryptographic credential-revocation mechanism.
8. Securely retire local real `.env.production` / `.env.staging` files, generated headers, compiled firmware, old builds, screenshots/data exports and provider login caches when no longer needed. Private backup bundles include the old history and potentially personal data; retain them only deliberately and never upload them.
9. Confirm provider dashboards show no running project resources, schedules, billable subscriptions, custom domains, or project-specific active tokens. Keep this public source repository and its placeholder templates only.

## Publication audit and rewritten history

Before reconstructing the history, the seven reachable commits were scanned across all historical blobs for common credential formats (JWTs, Supabase secret keys, GitHub tokens, PEM private keys, Resend keys and AWS access IDs), plus exact matches against local environment values. Matches found were public URLs/identifiers, not private credentials. This does **not** prove no credential ever existed in an older deleted repository, chat, build artifact, fork, cached commit or external backup.

The rebuilt history excludes the old real-person mock data and customer email in the maintenance-script examples. Mock identities, contacts, addresses, coordinates, attachment paths and MACs have been replaced. Current configuration examples use placeholders and no original project reference.

The original Git metadata and worktree were backed up privately outside the repository before rewriting. They are deliberately not linked to the new history by a tag, branch, or remote-tracking reference. Commit dates reflect reconstruction time, not invented development dates.

**Rewriting local history does not erase remote copies.** Publishing over the old branch requires a separately approved force-with-lease push. Old GitHub pull-request refs, cached commit pages, forks and other people's clones may still retain old commits; request provider removal of sensitive cached content if necessary. Secret rotation is required for any actual exposure even after a history rewrite. Other remote branches/tags require separate review.

Automated scanning is a limited check, not a substitute for provider-side credential inventory and human review.
