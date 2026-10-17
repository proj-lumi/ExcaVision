#!/usr/bin/env node
// Reads configuration locally; never makes network calls or prints secret values.
import assert from "node:assert/strict";
import { readEnvironment } from "./environment.mjs";

const environment = process.argv[2];
const scopes = ["apps/admin", "apps/mobile", "apps/landing", "supabase", "scripts", "firmware/node"];
const files = Object.fromEntries(scopes.map((scope) => [scope, readEnvironment(scope, environment)]));
const required = {
  "apps/admin": ["NUXT_PUBLIC_SUPABASE_URL", "NUXT_PUBLIC_SUPABASE_KEY", "NUXT_SUPABASE_SECRET_KEY", "NUXT_INVITE_REDIRECT_URL"],
  "apps/mobile": ["NUXT_PUBLIC_SUPABASE_URL", "NUXT_PUBLIC_SUPABASE_KEY", "NUXT_PUBLIC_VAPID_KEY", "NUXT_PUBLIC_LANDING_URL"],
  "apps/landing": ["PUBLIC_SUPABASE_INTAKE_URL", "PUBLIC_TURNSTILE_SITE_KEY"],
  supabase: ["TURNSTILE_SECRET", "ABUSE_HASH_SECRET", "PUBLIC_LANDING_ORIGINS", "ANOMALY_JOB_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "MOBILE_APP_ORIGINS", "RESEND_API_KEY", "ALERT_EMAIL_FROM", "ALERT_EMAIL_ORIGIN", "ALERT_EMAIL_LOGO_URL"],
  scripts: ["SUPABASE_PROJECT_REF", "SUPABASE_API_URL", "SUPABASE_SECRET_KEY"],
  "firmware/node": ["SUPABASE_URL"],
};
for (const [scope, names] of Object.entries(required)) {
  for (const name of names) {
    assert(files[scope][name] && !/REPLACE_ME|CHANGE_ME|PROJECT_REF/.test(files[scope][name]), `${scope}: configure ${name}`);
  }
}
const admin = files["apps/admin"], mobile = files["apps/mobile"], landing = files["apps/landing"], backend = files.supabase;
const url = files.scripts.SUPABASE_API_URL;
assert.match(files.scripts.SUPABASE_PROJECT_REF, /^[a-z]{20}$/, "scripts: invalid project reference");
assert.equal(url, `https://${files.scripts.SUPABASE_PROJECT_REF}.supabase.co`, "scripts: API URL/project mismatch");
assert.equal(admin.NUXT_PUBLIC_SUPABASE_URL, url, "Admin project mismatch");
assert.equal(mobile.NUXT_PUBLIC_SUPABASE_URL, url, "Mobile project mismatch");
assert.equal(files["firmware/node"].SUPABASE_URL, url, "Firmware project mismatch");
assert.equal(landing.PUBLIC_SUPABASE_INTAKE_URL, `${url}/functions/v1/submit-site-installation`, "Landing project mismatch");
assert.equal(mobile.NUXT_PUBLIC_VAPID_KEY, backend.VAPID_PUBLIC_KEY, "VAPID public keys must match");
const invite = new URL(admin.NUXT_INVITE_REDIRECT_URL);
assert.equal(invite.pathname, "/invite", "Admin redirect must use /invite");
assert.equal(backend.ALERT_EMAIL_ORIGIN, invite.origin, "Alert links must point to this environment's PWA");
assert((backend.MOBILE_APP_ORIGINS ?? "").split(",").map((v) => v.trim()).includes(invite.origin), "Allow the PWA origin in MOBILE_APP_ORIGINS");
assert((backend.PUBLIC_LANDING_ORIGINS ?? "").split(",").map((v) => v.trim()).includes(mobile.NUXT_PUBLIC_LANDING_URL), "Landing CORS origin mismatch");
for (const name of ["MOBILE_APP_ORIGINS", "PUBLIC_LANDING_ORIGINS"]) {
  for (const origin of backend[name].split(",").map((v) => v.trim())) {
    assert.equal(new URL(origin).origin, origin, `${name}: use exact origins without trailing slashes`);
  }
}
assert.notEqual(backend.ALLOW_UNVERIFIED_LOCAL_INTAKE, "true", "Hosted intake must verify Turnstile");
assert.notEqual(landing.PUBLIC_ALLOW_UNVERIFIED_INTAKE, "true", "Hosted intake must verify Turnstile");
for (const scope of ["apps/admin", "apps/mobile", "apps/landing"]) {
  for (const [name, value] of Object.entries(files[scope])) {
    if (!/^(NUXT_PUBLIC_|PUBLIC_)/.test(name)) continue;
    assert(!value.startsWith("sb_secret_"), `${scope}: privileged key in public variable ${name}`);
    if (value.startsWith("eyJ")) {
      const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
      assert.notEqual(claims.role, "service_role", `${scope}: service-role JWT in public variable ${name}`);
    }
  }
}
const other = environment === "production" ? "staging" : "production";
try {
  const otherValues = readEnvironment("scripts", other);
  assert.notEqual(otherValues.SUPABASE_PROJECT_REF, files.scripts.SUPABASE_PROJECT_REF, "Production and staging must not share a project");
} catch (error) {
  if (!error.message.startsWith("Missing ")) throw error;
}
console.log(`${environment}: configuration checks passed for all six scopes; secret values were not printed.`);
