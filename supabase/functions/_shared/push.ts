import webpush from "npm:web-push@3.6.7";
import { ALERT_EMAIL_HTML } from "./alertEmailHtml.ts";

type AlertKind = "threshold" | "anomaly";
type StoredSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushSummary = {
  recipients: number;
  accepted: number;
  expired: number;
  failed: number;
};

type CriticalAlert = {
  email: string;
  fullName: string;
  siteName: string;
  unitName: string;
  observedValue: number;
  threshold: number;
  detectedAt: string;
};

function serviceHeaders() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function supabaseJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function removeExpiredSubscription(endpoint: string) {
  const response = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
    { method: "DELETE", headers: serviceHeaders() },
  );
  if (!response.ok) console.error("[push] unable to remove expired subscription", response.status);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}

function appOrigin() {
  return (Deno.env.get("ALERT_EMAIL_ORIGIN") ?? "https://app.excavision.cc").replace(/\/$/, "");
}

// The alert markup lives in supabase/templates/alert.html and is compiled into
// ./alertEmailHtml.ts, so the reviewed template is the single source of truth.
function renderAlertEmail(values: Record<string, string>) {
  return ALERT_EMAIL_HTML.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? "");
}

function payload(kind: AlertKind, eventId: string, body: string) {
  return JSON.stringify({
    title: kind === "threshold" ? "Critical monitoring alert" : "Movement warning",
    body,
    tag: `excavision-${kind}-${eventId}`,
    url: `/alerts?event=${encodeURIComponent(eventId)}`,
  });
}

// Push text carries the number the operator needs, so the notification itself is
// actionable. Falls back to the generic line if the event cannot be read.
const GENERIC_PUSH_BODY = "Open ExcaVision to review the alert.";

async function anomalyPushBody(eventId: string) {
  try {
    const events = await supabaseJson(
      `/rest/v1/anomaly_events?select=observed_value_deg,baseline_value_deg&id=eq.${encodeURIComponent(eventId)}&limit=1`,
    ) as { observed_value_deg: number; baseline_value_deg: number }[];
    const event = events[0];
    if (!event) return GENERIC_PUSH_BODY;
    const movement = Math.abs(Number(event.observed_value_deg) - Number(event.baseline_value_deg));
    return `Moved ${movement.toFixed(2)}° from normal - now ${Number(event.observed_value_deg).toFixed(2)}°.`;
  } catch (error) {
    console.error("[push] anomaly body lookup failed", eventId, error);
    return GENERIC_PUSH_BODY;
  }
}

async function thresholdPushBody(eventId: string) {
  try {
    const events = await supabaseJson(
      `/rest/v1/threshold_events?select=observed_value_deg,threshold_deg&id=eq.${encodeURIComponent(eventId)}&limit=1`,
    ) as { observed_value_deg: number; threshold_deg: number }[];
    const event = events[0];
    if (!event) return GENERIC_PUSH_BODY;
    return `Tilt reached ${Number(event.observed_value_deg).toFixed(2)}°, over the ${Number(event.threshold_deg).toFixed(2)}° threshold.`;
  } catch (error) {
    console.error("[push] threshold body lookup failed", eventId, error);
    return GENERIC_PUSH_BODY;
  }
}

/**
 * Best-effort delivery only. The persisted alert remains the source of truth.
 * Browser push services return acceptance, not a guarantee that a device showed
 * the message.
 */
export async function sendAlertPush(kind: AlertKind, eventId: string): Promise<PushSummary> {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!publicKey || !privateKey || !subject) {
    console.warn("[push] VAPID is not configured; alert push skipped");
    return { recipients: 0, accepted: 0, expired: 0, failed: 0 };
  }

  const subscriptions = await supabaseJson("/rest/v1/rpc/get_push_subscriptions_for_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_event_kind: kind, target_event_id: eventId }),
  }) as StoredSubscription[];

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const body = kind === "threshold" ? await thresholdPushBody(eventId) : await anomalyPushBody(eventId);
  const summary: PushSummary = { recipients: subscriptions.length, accepted: 0, expired: 0, failed: 0 };
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload(kind, eventId, body), { TTL: 300, urgency: "high" });
      summary.accepted += 1;
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        summary.expired += 1;
        await removeExpiredSubscription(subscription.endpoint);
        return;
      }
      summary.failed += 1;
      console.error("[push] alert delivery failed", { kind, eventId, statusCode });
    }
  }));
  return summary;
}

async function criticalAlertDetails(eventId: string): Promise<CriticalAlert | null> {
  const events = await supabaseJson(
    `/rest/v1/threshold_events?select=unit_id,observed_value_deg,threshold_deg,detected_at&id=eq.${encodeURIComponent(eventId)}&limit=1`,
  ) as { unit_id: string; observed_value_deg: number; threshold_deg: number; detected_at: string }[];
  const event = events[0];
  if (!event) return null;

  const units = await supabaseJson(
    `/rest/v1/units?select=name,site_id&id=eq.${encodeURIComponent(event.unit_id)}&limit=1`,
  ) as { name: string; site_id: string }[];
  const unit = units[0];
  if (!unit) return null;

  const sites = await supabaseJson(
    `/rest/v1/sites?select=name,customer_id&id=eq.${encodeURIComponent(unit.site_id)}&archived_at=is.null&limit=1`,
  ) as { name: string; customer_id: string | null }[];
  const site = sites[0];
  if (!site?.customer_id) return null;

  const profiles = await supabaseJson(
    `/rest/v1/profiles?select=email,full_name&role=eq.customer&account_status=eq.active&id=eq.${encodeURIComponent(site.customer_id)}&limit=1`,
  ) as { email: string; full_name: string }[];
  const profile = profiles[0];
  if (!profile) return null;
  return {
    email: profile.email,
    fullName: profile.full_name,
    siteName: site.name,
    unitName: unit.name,
    observedValue: Number(event.observed_value_deg),
    threshold: Number(event.threshold_deg),
    detectedAt: event.detected_at,
  };
}

export async function sendCriticalAlertEmail(eventId: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("ALERT_EMAIL_FROM") ?? "";
  if (!apiKey || !from) {
    console.warn("[email] Resend is not configured; critical alert email skipped");
    return { sent: false, reason: "not_configured" } as const;
  }

  const alert = await criticalAlertDetails(eventId);
  if (!alert) return { sent: false, reason: "recipient_not_found" } as const;

  const siteName = escapeHtml(alert.siteName);
  const unitName = escapeHtml(alert.unitName);
  const fullName = escapeHtml(alert.fullName);
  const observed = alert.observedValue.toFixed(2);
  const threshold = alert.threshold.toFixed(2);
  const alertUrl = `${appOrigin()}/alerts?event=${encodeURIComponent(eventId)}`;
  const logoUrl = Deno.env.get("ALERT_EMAIL_LOGO_URL") ?? `${appOrigin()}/icon-192.png`;
  const html = renderAlertEmail({
    logoUrl: escapeHtml(logoUrl),
    fullName,
    siteName,
    unitName,
    observed,
    threshold,
    alertUrl: escapeHtml(alertUrl),
  });
  const text = `Critical alert for ${alert.siteName} / ${alert.unitName}: observed ${observed}°, threshold ${threshold}°. Review: ${alertUrl}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [alert.email], subject: `Critical movement alert · ${alert.siteName}`, html, text }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${details.slice(0, 200)}`);
  }
  return { sent: true, recipient: alert.email } as const;
}
