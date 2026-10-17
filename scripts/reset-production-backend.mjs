#!/usr/bin/env node

/**
 * Reset hosted ExcaVision operational data so node/site registration can be
 * repeated from a clean state.
 *
 * Preserved deliberately:
 *   - Admin auth.users and public.profiles rows (keep Admin login available)
 *   - database schema, migrations, functions, Storage buckets, and settings
 *
 * Removed:
 *   - sites, units, nodes, sensors, node credentials (through node cascade)
 *   - readings, baselines, threshold alerts, anomaly events, detector runs
 *   - service requests, request attachments/abuse signals, attachment objects
 *   - push subscriptions
 *   - customer profiles and customer Auth users
 *
 * Power the Gateway and sensor nodes down before running this script. A live
 * Gateway can recreate readings while the reset is in progress.
 *
 * Usage:
 *   node scripts/reset-production-backend.mjs --environment staging --dry-run
 *   node scripts/reset-production-backend.mjs --environment staging --confirm-staging --project-ref <project-ref>
 * Despite the legacy filename, both environments are supported explicitly.
 */
import { operationalEnvironment } from "./environment.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const { environment, projectRef: canonicalProject, values } = operationalEnvironment(args, { destructive: true });
const supabaseUrl = values.SUPABASE_API_URL;
const serviceKey = values.SUPABASE_SECRET_KEY;

const baseUrl = supabaseUrl.replace(/\/$/, "");
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function rest(pathname, init = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${pathname}: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getAll(table, select, extra = "") {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const suffix = `${extra}${extra ? "&" : ""}limit=1000&offset=${offset}`;
    const page = await rest(`${table}?select=${select}&${suffix}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function deleteByIds(table, ids, idColumn = "id") {
  let deleted = 0;
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    await rest(`${table}?${idColumn}=in.(${batch.join(",")})`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    deleted += batch.length;
  }
  return deleted;
}

async function deleteAll(table, idColumn = "id") {
  const rows = await getAll(table, idColumn);
  return deleteByIds(table, rows.map((row) => row[idColumn]), idColumn);
}

async function removeAuthUsers(ids) {
  let removed = 0;
  for (const id of ids) {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users/${id}`, { method: "DELETE", headers });
    if (!response.ok) throw new Error(`DELETE auth user ${id}: ${response.status} ${await response.text()}`);
    removed += 1;
  }
  return removed;
}

async function removeStorageObjects(paths) {
  let removed = 0;
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = paths.slice(offset, offset + 100);
    const response = await fetch(`${baseUrl}/storage/v1/object/request-attachments`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ prefixes: batch }),
    });
    if (!response.ok) {
      throw new Error(`POST storage object removal: ${response.status} ${await response.text()}`);
    }
    removed += batch.length;
  }
  return removed;
}

const profiles = await getAll("profiles", "id,auth_user_id,role");
const adminProfiles = profiles.filter((row) => row.role === "admin");
const customerProfiles = profiles.filter((row) => row.role === "customer");
const customerProfileIds = customerProfiles.map((row) => row.id);
const customerAuthIds = customerProfiles.map((row) => row.auth_user_id).filter(Boolean);

const sites = await getAll("sites", "id");
const siteIds = sites.map((row) => row.id);
const units = siteIds.length
  ? await getAll("units", "id", `site_id=in.(${siteIds.join(",")})`)
  : [];
const unitIds = units.map((row) => row.id);
const nodes = await getAll("nodes", "id");
const nodeIds = nodes.map((row) => row.id);
const sensors = nodeIds.length
  ? await getAll("sensors", "id", `node_id=in.(${nodeIds.join(",")})`)
  : [];
const sensorIds = sensors.map((row) => row.id);
const requests = await getAll("service_requests", "id");
const requestIds = requests.map((row) => row.id);
const attachments = requestIds.length
  ? await getAll("request_attachments", "id,storage_path", `request_id=in.(${requestIds.join(",")})`)
  : [];

const plan = [
  ["sensor_readings", sensorIds.length],
  ["sensor_baselines", sensorIds.length],
  ["anomaly_analysis_runs", sensorIds.length],
  ["anomaly_events", unitIds.length],
  ["threshold_events", unitIds.length],
  ["sensors", sensorIds.length],
  ["nodes", nodeIds.length],
  ["units", unitIds.length],
  ["sites", siteIds.length],
  ["request_attachments", attachments.length],
  ["request_abuse_signals", requestIds.length],
  ["service_requests", requestIds.length],
  ["customer_profiles", customerProfileIds.length],
  ["customer_auth_users", customerAuthIds.length],
  ["push_subscriptions", "all"],
];

console.log(`\n${dryRun ? "DRY RUN — nothing will be written" : `${environment.toUpperCase()} RESET — deleting operational data`}`);
console.log(`project: ${canonicalProject}`);
console.log(`preserved: ${adminProfiles.length} Admin profile(s) and Auth user(s), schema, functions, buckets, settings`);
console.log(`sites=${sites.length} units=${units.length} nodes=${nodes.length} sensors=${sensors.length} requests=${requests.length}`);
console.log("\nplanned deletions:");
for (const [table, count] of plan) console.log(`  ${table.padEnd(24)} ${count}`);

if (dryRun) process.exit(0);

const deleted = [];
const run = async (label, action) => {
  const count = await action();
  deleted.push([label, count]);
};

// Children first: most operational tables intentionally use RESTRICT FKs.
await run("sensor_readings", () => sensorIds.length ? deleteByIds("sensor_readings", sensorIds, "sensor_id") : 0);
await run("sensor_baselines", () => sensorIds.length ? deleteByIds("sensor_baselines", sensorIds, "sensor_id") : 0);
await run("anomaly_analysis_runs", () => sensorIds.length ? deleteByIds("anomaly_analysis_runs", sensorIds, "sensor_id") : 0);
await run("anomaly_events", () => unitIds.length ? deleteByIds("anomaly_events", unitIds, "unit_id") : 0);
await run("threshold_events", () => unitIds.length ? deleteByIds("threshold_events", unitIds, "unit_id") : 0);
await run("sensors", () => deleteByIds("sensors", sensorIds));
await run("nodes", () => deleteByIds("nodes", nodeIds));
await run("units", () => deleteByIds("units", unitIds));
await run("sites", () => deleteByIds("sites", siteIds));

if (attachments.length) {
  const paths = attachments.map((row) => row.storage_path).filter(Boolean);
  try {
    const removed = await removeStorageObjects(paths);
    console.log(`storage objects removed: ${removed}`);
  } catch (error) {
    console.warn(`WARNING: database reset will continue, but storage cleanup failed: ${error.message}`);
  }
}
await run("request_attachments", () => deleteByIds("request_attachments", attachments.map((row) => row.id)));
await run("request_abuse_signals", () => requestIds.length ? deleteByIds("request_abuse_signals", requestIds, "request_id") : 0);
await run("service_requests", () => deleteByIds("service_requests", requestIds));
await run("customer_profiles", () => deleteByIds("profiles", customerProfileIds));
await run("customer_auth_users", () => removeAuthUsers(customerAuthIds));
await run("push_subscriptions", () => deleteAll("push_subscriptions"));

console.log("\nreset complete:");
for (const [label, count] of deleted) console.log(`  ${label.padEnd(24)} ${count}`);
console.log("Admin profiles and Auth users were preserved; customer profiles and Auth users were removed.");
