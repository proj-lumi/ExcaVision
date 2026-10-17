// Local demo seed; hosted seeding requires an explicit environment and opt-in.
import { execSync } from "node:child_process";
import { operationalEnvironment } from "../scripts/environment.mjs";

const args = process.argv.slice(2);
if (args.length) {
  const { environment, values } = operationalEnvironment(args);
  if (!args.includes("--allow-hosted-seed")) throw new Error("Hosted seeding requires --allow-hosted-seed.");
  if (environment === "production" && values.ADMIN_ONLY !== "true") throw new Error("Production seeding permits ADMIN_ONLY=true only.");
  if (!values.SEED_ADMIN_PASSWORD || values.SEED_ADMIN_PASSWORD === "password123" || /REPLACE_ME|CHANGE_ME/.test(values.SEED_ADMIN_PASSWORD)) throw new Error("Set a fresh SEED_ADMIN_PASSWORD.");
  if (values.ADMIN_ONLY !== "true" && (!values.SEED_DEMO_PASSWORD || values.SEED_DEMO_PASSWORD === "password123" || /REPLACE_ME|CHANGE_ME/.test(values.SEED_DEMO_PASSWORD))) throw new Error("Set a fresh SEED_DEMO_PASSWORD.");
  Object.assign(process.env, values, { ALLOW_HOSTED_DEMO_SEED: "true" });
} else if (process.env.SUPABASE_API_URL && !["localhost", "127.0.0.1"].includes(new URL(process.env.SUPABASE_API_URL).hostname)) {
  throw new Error("Hosted seeding requires --environment and --allow-hosted-seed.");
}

const API = process.env.SUPABASE_API_URL ?? "http://127.0.0.1:54321";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "password123";
const DEMO_DOMAIN = process.env.SEED_DEMO_DOMAIN ?? "demo.excavision.local";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@example.invalid";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "password123";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Site Manager";
const DEMO_PHONE = process.env.SEED_DEMO_PHONE || `09${"0".repeat(9)}`;
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE || DEMO_PHONE;
const isLocalApi = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(API).host);
if (!isLocalApi && process.env.ALLOW_HOSTED_DEMO_SEED !== "true") {
  throw new Error("This demo seed is local-only. Set ALLOW_HOSTED_DEMO_SEED=true explicitly before using another API.");
}

const IDS = {
  adminProfile: process.env.SEED_ADMIN_PROFILE_ID ?? "10000000-0000-4000-8000-000000000000",
  activeProfile: "10000000-0000-4000-8000-000000000001",
  pendingProfile: "10000000-0000-4000-8000-000000000002",
  disabledProfile: "10000000-0000-4000-8000-000000000003",
  activeSite: "20000000-0000-4000-8000-000000000001",
  invitedSite: "20000000-0000-4000-8000-000000000002",
  uninvitedSite: "20000000-0000-4000-8000-000000000003",
  archivedSite: "20000000-0000-4000-8000-000000000004",
  activeUnit: "30000000-0000-4000-8000-000000000001",
  setupUnit: "30000000-0000-4000-8000-000000000002",
  archivedUnit: "30000000-0000-4000-8000-000000000003",
  invitedUnit: "30000000-0000-4000-8000-000000000004",
  uninvitedUnit: "30000000-0000-4000-8000-000000000005",
  archivedNode: "40000000-0000-4000-8000-000000000001",
  gatewayNode: "40000000-0000-4000-8000-000000000002",
  localNode: "40000000-0000-4000-8000-000000000003",
  offlineNode: "40000000-0000-4000-8000-000000000004",
  unassignedNode: "40000000-0000-4000-8000-000000000005",
  invitedGatewayNode: "40000000-0000-4000-8000-000000000006",
  invitedSlaveNode: "40000000-0000-4000-8000-000000000007",
  uninvitedGatewayNode: "40000000-0000-4000-8000-000000000008",
  activeInstallRequest: "50000000-0000-4000-8000-000000000001",
  completedInstallRequest: "50000000-0000-4000-8000-000000000002",
  spamRequest: "50000000-0000-4000-8000-000000000003",
  receivedRequest: "50000000-0000-4000-8000-000000000004",
  reviewRequest: "50000000-0000-4000-8000-000000000005",
  scheduledRequest: "50000000-0000-4000-8000-000000000006",
  completeRequest: "50000000-0000-4000-8000-000000000007",
  repairRequest: "50000000-0000-4000-8000-000000000008",
  thresholdEvent: "60000000-0000-4000-8000-000000000001",
  acknowledgedThresholdEvent: "60000000-0000-4000-8000-000000000002",
  anomalyEvent: "70000000-0000-4000-8000-000000000001",
};

const SENSOR_IDS = new Map();
const SENSOR_CHANNELS = [7, 3, 5, 1];
const SENSOR_LABELS = ["Sensor 1", "Sensor 2", "Sensor 3", "Sensor 4"];

function secretKey() {
  if (process.env.SUPABASE_SECRET_KEY) return process.env.SUPABASE_SECRET_KEY;
  // Legacy local fallback: `supabase status` still exposes the local development key.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
    if (status.SERVICE_ROLE_KEY) return status.SERVICE_ROLE_KEY;
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error("Could not resolve the Supabase secret key. Run `supabase start` locally or set SUPABASE_SECRET_KEY.");
}

const SECRET_KEY = secretKey();
const serviceHeaders = {
  Authorization: `Bearer ${SECRET_KEY}`,
  apikey: SECRET_KEY,
  "Content-Type": "application/json",
};

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...serviceHeaders, ...(init.headers ?? {}) },
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function upsert(table, rows, conflict = "id") {
  if (!rows.length) return;
  await api(`/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
}

async function patch(table, filter, values) {
  await api(`/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(values),
  });
}

async function deleteWhere(table, filter) {
  await api(`/rest/v1/${table}?${filter}`, { method: "DELETE" });
}

async function ensureAuthUser(email, fullName, role, password = DEMO_PASSWORD) {
  const create = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, full_name: fullName, seed: "demo" },
    }),
  });
  if (create.ok) return (await create.json()).id;
  if (create.status !== 422) {
    throw new Error(`POST /auth/v1/admin/users failed (${create.status}): ${await create.text()}`);
  }

  const list = await api("/auth/v1/admin/users?per_page=1000");
  const users = Array.isArray(list) ? list : list.users ?? [];
  const existing = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (!existing) throw new Error(`Auth user already exists but could not be found: ${email}`);

  await api(`/auth/v1/admin/users/${existing.id}`, {
    method: "PUT",
    body: JSON.stringify({
      password,
      email_confirm: true,
      user_metadata: { role, full_name: fullName, seed: "demo" },
    }),
  });
  return existing.id;
}

function profile(id, authUserId, role, fullName, email, phone, companyName, accountStatus) {
  return {
    id,
    auth_user_id: authUserId,
    role,
    full_name: fullName,
    email,
    phone,
    company_name: companyName,
    account_status: accountStatus,
  };
}

function request(id, requestType, status, requesterId, requesterName, companyName, email, phone, siteName, address, latitude, longitude, details, submittedAt, completedAt = null) {
  return {
    id,
    request_type: requestType,
    status,
    requester_id: requesterId,
    requester_name: requesterName,
    company_name: companyName,
    contact_email: email,
    contact_phone: phone,
    site_id: null,
    site_name: siteName,
    address_label: address,
    latitude,
    longitude,
    details,
    submitted_at: submittedAt,
    completed_at: completedAt,
  };
}

function site(id, slug, name, address, latitude, longitude, companyName, customerId, sourceRequestId, invitationStatus, invitationSentAt, archivedAt = null) {
  return {
    id,
    slug,
    name,
    address_label: address,
    latitude,
    longitude,
    company_name: companyName,
    customer_id: customerId,
    source_request_id: sourceRequestId,
    invitation_status: invitationStatus,
    invitation_sent_at: invitationSentAt,
    archived_at: archivedAt,
  };
}

function unit(id, slug, siteId, name, status, threshold, archivedAt = null) {
  return { id, slug, site_id: siteId, name, status, alert_threshold_deg: threshold, archived_at: archivedAt };
}

function node(id, macAddress, status, unitId, position, connectionState, lastSeenAt, archivedAt = null) {
  return {
    id,
    mac_address: macAddress,
    status,
    unit_id: unitId,
    position,
    connection_state: connectionState,
    last_seen_at: lastSeenAt,
    archived_at: archivedAt,
  };
}

function sensorId(nodeId, position) {
  const key = `${nodeId}:${position}`;
  if (!SENSOR_IDS.has(key)) {
    const number = SENSOR_IDS.size + 1;
    SENSOR_IDS.set(key, `80000000-0000-4000-8000-${String(number).padStart(12, "0")}`);
  }
  return SENSOR_IDS.get(key);
}

function sensorsForNode(nodeId) {
  return SENSOR_CHANNELS.map((hardwareChannel, index) => ({
    id: sensorId(nodeId, index + 1),
    node_id: nodeId,
    position: index + 1,
    hardware_channel: hardwareChannel,
    label: SENSOR_LABELS[index],
  }));
}

function isoAgo(milliseconds) {
  return new Date(Date.now() - milliseconds).toISOString();
}

function assertSeed(condition, message) {
  if (!condition) throw new Error(`Seed validation failed: ${message}`);
}

function readingRows(sensor, options = {}) {
  const rows = [];
  const age = options.age ?? 120_000;
  const base = options.base ?? 0.35;
  const failed = Boolean(options.failed);
  const anomaly = Boolean(options.anomaly);
  for (let index = 0; index < 65; index += 1) {
    const isCandidate = index === 0;
    const tilt = anomaly && isCandidate
      ? 8.75
      : base + Math.sin(index / 5) * 0.035 + Math.cos(index / 9) * 0.015;
    rows.push({
      sensor_id: sensor.id,
      tilt_deg: Number(tilt.toFixed(4)),
      gravity_magnitude_g: Number((failed && isCandidate ? 0.0 : 1 + Math.sin(index / 8) * 0.01).toFixed(4)),
      temperature_c: Number((27 + Math.sin(index / 7)).toFixed(2)),
      sample_count: failed && isCandidate ? 0 : 4,
      failure_count: failed && isCandidate ? 4 : 0,
      alert_flag: Boolean(options.alert && isCandidate),
      recorded_at: new Date(Date.now() - age - index * 300_000).toISOString(),
    });
  }
  return rows;
}

async function validateSeedState() {
  const seededSites = await api(`/rest/v1/sites?select=id,customer_id,invitation_status,invitation_sent_at,archived_at&id=in.(${[IDS.activeSite, IDS.invitedSite, IDS.uninvitedSite, IDS.archivedSite].join(",")})`);
  const siteById = new Map(seededSites.map((item) => [item.id, item]));
  assertSeed(seededSites.length === 4, "all four demo sites exist");
  assertSeed(siteById.get(IDS.activeSite)?.customer_id === IDS.activeProfile && siteById.get(IDS.activeSite)?.invitation_status === "activated", "active customer owns the activated site");
  assertSeed(siteById.get(IDS.invitedSite)?.customer_id === IDS.pendingProfile && siteById.get(IDS.invitedSite)?.invitation_status === "invited", "pending customer owns the invited site");
  const pendingProfile = (await api(`/rest/v1/profiles?select=auth_user_id&id=eq.${IDS.pendingProfile}`))[0];
  assertSeed(pendingProfile?.auth_user_id === null, "pending customer has no Auth user before invitation");
  assertSeed(siteById.get(IDS.uninvitedSite)?.customer_id === null && siteById.get(IDS.uninvitedSite)?.invitation_status === "not_invited", "unassigned site has no invitation");
  assertSeed(siteById.get(IDS.archivedSite)?.archived_at && siteById.get(IDS.archivedSite)?.invitation_status === "activated", "archived site remains historical");

  const seededUnits = await api(`/rest/v1/units?select=id,status,archived_at&site_id=in.(${[IDS.activeSite, IDS.invitedSite, IDS.uninvitedSite, IDS.archivedSite].join(",")})`);
  assertSeed(seededUnits.length === 5, "five demo Units exist");
  assertSeed(new Set(seededUnits.map((item) => item.status)).size === 3, "active, setup-pending, and archived Unit states exist");

  const seededNodeIds = [
    IDS.archivedNode,
    IDS.gatewayNode,
    IDS.localNode,
    IDS.offlineNode,
    IDS.unassignedNode,
    IDS.invitedGatewayNode,
    IDS.invitedSlaveNode,
    IDS.uninvitedGatewayNode,
  ];
  const seededNodes = await api(`/rest/v1/nodes?select=id,status,connection_state&id=in.(${seededNodeIds.join(",")})`);
  assertSeed(seededNodes.length === 8, "eight demo nodes exist");
  assertSeed(new Set(seededNodes.map((item) => item.status)).size === 3, "assigned, unassigned, and archived node states exist");
  assertSeed(new Set(seededNodes.map((item) => item.connection_state)).size === 4, "all node connection states exist");

  const readingsResponse = await fetch(`${API}/rest/v1/sensor_readings?select=id&limit=1`, {
    method: "HEAD",
    headers: { ...serviceHeaders, Prefer: "count=exact" },
  });
  assertSeed(readingsResponse.ok && readingsResponse.headers.get("content-range")?.endsWith("/1495"), "exactly 1,495 demo readings exist");
}

async function main() {
  const activeEmail = `active.customer@${DEMO_DOMAIN}`;
  const pendingEmail = `pending.customer@${DEMO_DOMAIN}`;
  const disabledEmail = `disabled.customer@${DEMO_DOMAIN}`;
  const adminAuthId = await ensureAuthUser(ADMIN_EMAIL, ADMIN_NAME, "admin", ADMIN_PASSWORD);
  if (process.env.ADMIN_ONLY === "true") {
    await upsert("profiles", [profile(IDS.adminProfile, adminAuthId, "admin", ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE, "ExcaVision", "active")]);
    console.log("Admin-only seed complete. Password was not logged.");
    return;
  }

  const activeAuthId = await ensureAuthUser(activeEmail, "Active Customer", "customer");
  const disabledAuthId = await ensureAuthUser(disabledEmail, "Disabled Customer", "customer");

  await upsert("profiles", [
    profile(IDS.adminProfile, adminAuthId, "admin", ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE, "ExcaVision", "active"),
    profile(IDS.activeProfile, activeAuthId, "customer", "Active Customer", activeEmail, DEMO_PHONE, "Example Organization A", "active"),
    profile(IDS.pendingProfile, null, "customer", "Pending Customer", pendingEmail, DEMO_PHONE, "Example Organization B", "pending"),
    profile(IDS.disabledProfile, disabledAuthId, "customer", "Disabled Customer", disabledEmail, DEMO_PHONE, "Example Organization C", "disabled"),
  ]);

  const requests = [
    request(IDS.activeInstallRequest, "site_installation", "completed", null, "Demo Installer A", "Example Organization A", "installer-a@example.invalid", DEMO_PHONE, "Harbor Works Monitoring Site", "Cebu City, Cebu", 10.3157, 123.8854, "Commissioned active demo site with live and stale node states.", isoAgo(40 * 86400000), isoAgo(39 * 86400000)),
    request(IDS.completedInstallRequest, "site_installation", "completed", null, "Demo Installer B", "Example Organization B", "installer-b@example.invalid", DEMO_PHONE, "Ridge Builders Test Site", "Davao City, Davao del Sur", 7.1907, 125.4553, "Reviewed installation awaiting customer activation.", isoAgo(12 * 86400000), isoAgo(11 * 86400000)),
    request(IDS.spamRequest, "site_installation", "spam", null, "Suspicious Submission", "", "spam@example.invalid", DEMO_PHONE, "Repeated Form Test", "Manila", 14.5995, 120.9842, "Seeded spam state for Admin quarantine styling.", isoAgo(10 * 86400000)),
    request(IDS.receivedRequest, "add_unit", "open", IDS.activeProfile, "Active Customer", "Example Organization A", activeEmail, DEMO_PHONE, "Harbor Works Monitoring Site", "Cebu City, Cebu", 10.3157, 123.8854, "Customer requested another Unit for the north warehouse.", isoAgo(7 * 86400000)),
    request(IDS.reviewRequest, "add_nodes", "completed", IDS.activeProfile, "Active Customer", "Example Organization A", activeEmail, DEMO_PHONE, "Harbor Works Monitoring Site", "Cebu City, Cebu", 10.3157, 123.8854, "More coverage request: add nodes to the existing Unit.", isoAgo(5 * 86400000), isoAgo(4 * 86400000)),
    request(IDS.scheduledRequest, "repair", "completed", IDS.activeProfile, "Active Customer", "Example Organization A", activeEmail, DEMO_PHONE, "Harbor Works Monitoring Site", "Cebu City, Cebu", 10.3157, 123.8854, "Repair visit scheduled for the offline node.", isoAgo(4 * 86400000), isoAgo(3 * 86400000)),
    request(IDS.completeRequest, "repair", "completed", IDS.activeProfile, "Active Customer", "Example Organization A", activeEmail, DEMO_PHONE, "Harbor Works Monitoring Site", "Cebu City, Cebu", 10.3157, 123.8854, "Historical repair completed successfully.", isoAgo(20 * 86400000), isoAgo(19 * 86400000)),
    request(IDS.repairRequest, "repair", "open", null, "New Repair Lead", "Example Organization D", "lead@example.invalid", DEMO_PHONE, "Plains Logistics Site", "Iloilo City, Iloilo", 10.7202, 122.5621, "Fresh public repair lead with no review timestamp.", isoAgo(2 * 3600000)),
  ];
  await upsert("service_requests", requests);

  await upsert("sites", [
    site(IDS.activeSite, "harbor-works-demo", "Harbor Works Monitoring Site", "Cebu City, Cebu", 10.3157, 123.8854, "Harbor Works Inc.", IDS.activeProfile, IDS.activeInstallRequest, "activated", isoAgo(38 * 86400000)),
    site(IDS.invitedSite, "ridge-builders-demo", "Ridge Builders Test Site", "Davao City, Davao del Sur", 7.1907, 125.4553, "Ridge Builders", IDS.pendingProfile, IDS.completedInstallRequest, "invited", isoAgo(10 * 86400000)),
    site(IDS.uninvitedSite, "plains-logistics-demo", "Plains Logistics Site", "Iloilo City, Iloilo", 10.7202, 122.5621, "Plains Logistics", null, IDS.repairRequest, "not_invited", null),
    site(IDS.archivedSite, "archive-test-site", "Archive Test Site", "Quezon City, Metro Manila", 14.6760, 121.0437, "Archive Test Co.", IDS.disabledProfile, IDS.completeRequest, "activated", isoAgo(80 * 86400000), isoAgo(30 * 86400000)),
  ]);

  for (const [requestId, siteId] of [
    [IDS.activeInstallRequest, IDS.activeSite],
    [IDS.completedInstallRequest, IDS.invitedSite],
    [IDS.repairRequest, IDS.uninvitedSite],
    [IDS.completeRequest, IDS.archivedSite],
  ]) await patch("service_requests", `id=eq.${requestId}`, { site_id: siteId });

  await upsert("units", [
    unit(IDS.activeUnit, "harbor-main-unit", IDS.activeSite, "Main Unit", "active", 2.0),
    unit(IDS.setupUnit, "harbor-setup-unit", IDS.activeSite, "North Expansion", "setup_pending", 3.5),
    unit(IDS.archivedUnit, "archive-legacy-unit", IDS.archivedSite, "Legacy Unit", "archived", 2.0, isoAgo(30 * 86400000)),
    unit(IDS.invitedUnit, "ridge-main-unit", IDS.invitedSite, "Main Unit", "active", 2.5),
    unit(IDS.uninvitedUnit, "plains-main-unit", IDS.uninvitedSite, "Main Unit", "active", 2.0),
  ]);

  await upsert("nodes", [
    node(IDS.gatewayNode, "AA:AA:AA:AA:AA:02", "assigned", IDS.activeUnit, 1, "cloud_online", isoAgo(90_000)),
    node(IDS.localNode, "AA:AA:AA:AA:AA:03", "assigned", IDS.activeUnit, 2, "local_reporting", isoAgo(150_000)),
    node(IDS.offlineNode, "AA:AA:AA:AA:AA:04", "assigned", IDS.activeUnit, 3, "offline", isoAgo(35 * 60_000)),
    node(IDS.unassignedNode, "AA:AA:AA:AA:AA:05", "unassigned", null, null, "unknown", null),
    node(IDS.invitedGatewayNode, "AA:AA:AA:AA:AA:06", "assigned", IDS.invitedUnit, 1, "cloud_online", isoAgo(120_000)),
    node(IDS.invitedSlaveNode, "AA:AA:AA:AA:AA:07", "assigned", IDS.invitedUnit, 2, "local_reporting", isoAgo(180_000)),
    node(IDS.uninvitedGatewayNode, "AA:AA:AA:AA:AA:08", "assigned", IDS.uninvitedUnit, 1, "unknown", null),
    node(IDS.archivedNode, "AA:AA:AA:AA:AA:01", "archived", IDS.archivedUnit, 1, "offline", isoAgo(45 * 86400000), isoAgo(30 * 86400000)),
  ]);

  const seededSensors = [
    ...sensorsForNode(IDS.gatewayNode),
    ...sensorsForNode(IDS.localNode),
    ...sensorsForNode(IDS.offlineNode),
    ...sensorsForNode(IDS.invitedGatewayNode),
    ...sensorsForNode(IDS.invitedSlaveNode),
    ...sensorsForNode(IDS.uninvitedGatewayNode),
    ...sensorsForNode(IDS.archivedNode),
  ];
  await upsert("sensors", seededSensors);

  const activeSensors = sensorsForNode(IDS.gatewayNode);
  const localSensors = sensorsForNode(IDS.localNode);
  const offlineSensors = sensorsForNode(IDS.offlineNode);
  const invitedSensors = [...sensorsForNode(IDS.invitedGatewayNode), ...sensorsForNode(IDS.invitedSlaveNode)];
  const archivedSensors = sensorsForNode(IDS.archivedNode);
  const allSeedSensorIds = seededSensors.map((sensor) => sensor.id);
  await deleteWhere("sensor_readings", `sensor_id=in.(${allSeedSensorIds.join(",")})`);

  const readings = [
    ...activeSensors.map((sensor, index) => readingRows(sensor, { base: index === 1 ? 2.6 : 0.25 + index * 0.08, alert: index === 1, anomaly: index === 2 })),
    ...localSensors.map((sensor, index) => readingRows(sensor, { base: 0.4 + index * 0.06, age: 180_000 })),
    ...offlineSensors.slice(0, 3).map((sensor, index) => readingRows(sensor, { base: 0.5 + index * 0.05, age: 35 * 60_000, failed: index === 2 })),
    ...invitedSensors.map((sensor, index) => readingRows(sensor, { base: 0.2 + index * 0.03, age: 120_000 })),
    ...archivedSensors.map((sensor, index) => readingRows(sensor, { base: 0.7 + index * 0.02, age: 45 * 86400000 })),
  ].flat();
  for (let offset = 0; offset < readings.length; offset += 500) {
    await upsert("sensor_readings", readings.slice(offset, offset + 500));
  }

  await upsert("sensor_baselines", seededSensors.map((sensor, index) => ({
    sensor_id: sensor.id,
    baseline_x: Number((Math.sin(index) * 0.02).toFixed(6)),
    baseline_y: Number((Math.cos(index) * 0.02).toFixed(6)),
    baseline_z: Number((1 - index * 0.001).toFixed(6)),
  })), "sensor_id");

  await upsert("threshold_events", [
    {
      id: IDS.thresholdEvent,
      unit_id: IDS.activeUnit,
      sensor_id: activeSensors[1].id,
      observed_value_deg: 3.42,
      threshold_deg: 2.0,
      detected_at: isoAgo(25 * 60_000),
      acknowledged_at: null,
    },
    {
      id: IDS.acknowledgedThresholdEvent,
      unit_id: IDS.activeUnit,
      sensor_id: activeSensors[0].id,
      observed_value_deg: 2.31,
      threshold_deg: 2.0,
      detected_at: isoAgo(3 * 86400000),
      acknowledged_at: isoAgo(2 * 86400000),
    },
  ]);

  await upsert("anomaly_events", [{
    id: IDS.anomalyEvent,
    unit_id: IDS.activeUnit,
    node_id: IDS.gatewayNode,
    sensor_id: activeSensors[2].id,
    detection_method: "isolation_forest",
    observed_value_deg: 8.75,
    baseline_value_deg: 0.41,
    anomaly_score: 0.93,
    anomalous_readings: 1,
    window_size: 64,
    model_version: "isolation-forest-v1",
    window_started_at: isoAgo(18 * 60_000),
    detected_at: isoAgo(18 * 60_000),
    acknowledged_at: null,
  }]);

  const attachments = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      request_id: IDS.activeInstallRequest,
      file_name: `harbor-site-${index + 1}.jpg`,
      storage_path: `seed/${IDS.activeInstallRequest}/harbor-site-${index + 1}.jpg`,
      mime_type: "image/jpeg",
      size_bytes: 180_000 + index * 12_000,
    })),
    {
      id: "90000000-0000-4000-8000-000000000006",
      request_id: IDS.repairRequest,
      file_name: "damaged-node.jpg",
      storage_path: `seed/${IDS.repairRequest}/damaged-node.jpg`,
      mime_type: "image/jpeg",
      size_bytes: 245_000,
    },
  ];
  await deleteWhere("request_attachments", `id=in.(${attachments.map((attachment) => attachment.id).join(",")})`);
  await upsert("request_attachments", attachments);
  await validateSeedState();

  console.log("Demo seed complete.");
  console.log(`Admin: ${ADMIN_EMAIL} (password not logged)`);
  console.log(`Active customer: ${activeEmail} (password not logged)`);
  console.log(`Pending invitation: ${pendingEmail} (send it from Admin, then open the Mailpit email)`);
  console.log(`Disabled customer: ${disabledEmail} (password not logged)`);
  console.log("Coverage: every request status, invitation state, account state, Unit state, node state, reading state, threshold state, and Isolation Forest event state.");
}

main()
  .catch((error) => {
    console.error("Demo seed failed:", error.message);
    process.exit(1);
  });
