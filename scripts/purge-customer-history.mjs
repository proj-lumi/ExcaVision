#!/usr/bin/env node

/**
 * Deletes monitoring history for one customer's sites: readings, threshold
 * alerts, Isolation Forest warnings, and the detector's analysis bookkeeping.
 *
 * Usage:
 *   node scripts/purge-customer-history.mjs --environment staging --customer customer@example.invalid --dry-run
 *   node scripts/purge-customer-history.mjs --environment staging --confirm-staging --project-ref <project-ref> --customer customer@example.invalid
 *
 * Not touched: sensor_baselines (that is the commissioned zero, not history),
 * service requests, attachments, sites, units, nodes and sensors.
 *
 * Power the site's nodes down first: a live Gateway keeps posting every 15 s and
 * will repopulate the history while this runs.
 */
import { operationalEnvironment, option as argument } from "./environment.mjs";

const args = process.argv.slice(2);
const option = (name) => argument(args, name);
const dryRun = args.includes("--dry-run");
const { values } = operationalEnvironment(args, { destructive: true });
const url = values.SUPABASE_API_URL;
const key = values.SUPABASE_SECRET_KEY;

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const get = async (query) => {
  const response = await fetch(`${url}/rest/v1/${query}`, { headers });
  if (!response.ok) throw new Error(`${query}: ${response.status} ${await response.text()}`);
  return response.json();
};
const count = async (table, filter) => {
  const response = await fetch(`${url}/rest/v1/${table}?select=id&${filter}`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  const total = response.headers.get("content-range")?.split("/")[1];
  return total ? Number(total) : 0;
};

// Deletes in chunks so any table size is safe.
async function deleteAll(table, filter, idColumn = "id") {
  let deleted = 0;
  for (;;) {
    const rows = await get(`${table}?select=${idColumn}&${filter}&limit=500`);
    if (!rows.length) break;
    if (dryRun) {
      // Count only. (This used to fall through to the DELETE below, so --dry-run
      // quietly deleted the first chunk of every table.)
      return rows.length;
    }
    const ids = rows.map((row) => row[idColumn]).join(",");
    const response = await fetch(`${url}/rest/v1/${table}?${idColumn}=in.(${ids})`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } });
    if (!response.ok) throw new Error(`delete ${table}: ${response.status} ${await response.text()}`);
    deleted += rows.length;
  }
  return deleted;
}

const customerEmail = option("customer");
if (!customerEmail) throw new Error("Pass --customer <email>");

const profiles = await get(`profiles?select=id,full_name,email&email=eq.${encodeURIComponent(customerEmail)}`);
const profile = profiles[0];
if (!profile) throw new Error(`No profile for ${customerEmail}`);

const sites = await get(`sites?select=id,name,customer_id&customer_id=eq.${profile.id}`);
if (!sites.length) throw new Error(`${customerEmail} has no sites`);
const siteIds = sites.map((site) => site.id).join(",");

const units = await get(`units?select=id,name,status&site_id=in.(${siteIds})`);
const unitIds = units.map((unit) => unit.id);
const nodes = unitIds.length ? await get(`nodes?select=id,mac_address,position,unit_id,status&unit_id=in.(${unitIds.join(",")})`) : [];
const nodeIds = nodes.map((node) => node.id);
const sensors = nodeIds.length ? await get(`sensors?select=id,node_id,position,hardware_channel&node_id=in.(${nodeIds.join(",")})`) : [];

console.log(`customer : ${profile.full_name} <${profile.email}>`);
console.log(`sites    : ${sites.map((site) => site.name).join(", ")}`);
console.log(`units    : ${units.map((unit) => `${unit.name} (${unit.status})`).join(", ") || "(none)"}`);
console.log(`nodes    : ${nodes.length} | sensors: ${sensors.length}`);
for (const node of nodes) {
  const own = sensors.filter((sensor) => sensor.node_id === node.id);
  console.log(`   ${node.mac_address} pos ${node.position}: ${own.map((sensor) => `ch${sensor.hardware_channel}`).join(", ") || "no sensors"}`);
}
if (!sensors.length) {
  console.log("\nNothing to delete: this site has no sensors.");
  process.exit(0);
}

const sensorIds = sensors.map((sensor) => sensor.id).join(",");
const sensorFilter = `sensor_id=in.(${sensorIds})`;
const unitFilter = `unit_id=in.(${unitIds.join(",")})`;

const scopes = [
  { table: "sensor_readings", filter: sensorFilter, label: "readings" },
  { table: "anomaly_events", filter: unitFilter, label: "warnings" },
  { table: "threshold_events", filter: unitFilter, label: "critical alerts" },
  { table: "anomaly_analysis_runs", filter: sensorFilter, label: "detector runs" },
];

console.log(`\n${dryRun ? "DRY RUN — nothing will be written" : "deleting history"}`);
for (const scope of scopes) {
  const found = await count(scope.table, scope.filter);
  const deleted = await deleteAll(scope.table, scope.filter);
  console.log(`   ${scope.label.padEnd(16)} found ${String(found).padStart(6)} | deleted ${dryRun ? 0 : deleted}`);
}

if (!dryRun) {
  console.log("\nremaining in scope:");
  for (const scope of scopes) {
    console.log(`   ${scope.label.padEnd(16)} ${await count(scope.table, scope.filter)}`);
  }
  console.log("\nsensor_baselines were kept: they are the commissioned zero, not history.");
}
