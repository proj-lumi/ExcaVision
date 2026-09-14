const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const NOTIFICATION_EMAIL = Deno.env.get('REQUEST_NOTIFICATION_EMAIL') ?? '';
const FROM_EMAIL = Deno.env.get('REQUEST_FROM_EMAIL') ?? '';
const DISABLE_SUBMISSION_COOLDOWN = Deno.env.get('DISABLE_SUBMISSION_COOLDOWN') === 'true';
const TURNSTILE_SECRET_KEY = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
const TURNSTILE_TEST_MODE = Deno.env.get('TURNSTILE_TEST_MODE') === 'true';
const TURNSTILE_ACTION = 'installation_request';
const ALLOW_UNVERIFIED_LOCAL_INTAKE = Deno.env.get('ALLOW_UNVERIFIED_LOCAL_INTAKE') === 'true';
const RATE_LIMIT_SALT = Deno.env.get('RATE_LIMIT_SALT') || SERVICE_ROLE_KEY.slice(-32);

const philippineBounds = {
  minLat: 4.2,
  maxLat: 21.5,
  minLng: 116.5,
  maxLng: 127.0,
};

interface TurnstileVerification {
  ok: boolean;
  status: number;
  error?: string;
  hostname?: string;
  action?: string;
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors);
  if (!originAllowed(request)) return json({ error: 'Origin not allowed.' }, 403, cors);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Supabase function environment is incomplete.');
    return json({ error: 'Request service is unavailable.' }, 503, cors);
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400, cors);
  }

  if (text(input.website)) return json({ accepted: true }, 202, cors);

  const requestType = text(input.requestType);
  const name = text(input.name);
  const company = optionalText(input.company);
  const email = text(input.email).toLowerCase();
  const phone = normalizePhone(input.phone);
  const locationName = text(input.locationName);
  const locationLabel = optionalText(input.locationLabel);
  const locationNotes = optionalText(input.locationNotes);
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const formStartedAt = Number(input.formStartedAt);

  const validationError = validate({
    requestType,
    name,
    company,
    email,
    phone,
    locationName,
    locationLabel,
    locationNotes,
    latitude,
    longitude,
    formStartedAt,
  });
  if (validationError) return json({ error: validationError }, 422, cors);

  const turnstile = await verifyTurnstile(request, text(input.turnstileToken));
  if (!turnstile.ok) return json({ error: turnstile.error }, turnstile.status, cors);

  try {
    const remoteIp = clientIp(request);
    const sourceIpHash = remoteIp ? await hashText(`${RATE_LIMIT_SALT}:${remoteIp}`) : null;
    const requestFingerprint = await hashText([
      email,
      locationName.toLowerCase(),
      latitude.toFixed(4),
      longitude.toFixed(4),
    ].join('|'));

    const osmUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    const payload = {
      request_type: 'Request installation',
      name,
      company,
      email,
      phone,
      location_name: locationName,
      location_label: locationLabel,
      location_notes: locationNotes,
      latitude,
      longitude,
      osm_url: osmUrl,
      google_maps_url: googleMapsUrl,
      source_ip_hash: sourceIpHash,
      request_fingerprint: requestFingerprint,
      turnstile_hostname: turnstile.hostname ?? null,
      turnstile_action: turnstile.action ?? null,
    };

    const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_public_installation_intake`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        p_name: payload.name,
        p_company: payload.company,
        p_email: payload.email,
        p_phone: payload.phone,
        p_location_name: payload.location_name,
        p_location_label: payload.location_label,
        p_location_notes: payload.location_notes,
        p_latitude: payload.latitude,
        p_longitude: payload.longitude,
        p_osm_url: payload.osm_url,
        p_google_maps_url: payload.google_maps_url,
        p_source_ip_hash: payload.source_ip_hash,
        p_request_fingerprint: payload.request_fingerprint,
        p_turnstile_hostname: payload.turnstile_hostname,
        p_turnstile_action: payload.turnstile_action,
        p_disable_cooldown: DISABLE_SUBMISSION_COOLDOWN,
      }),
    });
    const inserted = await readJson(insertResponse);
    if (!insertResponse.ok) {
      const databaseMessage = text((inserted as Record<string, unknown> | null)?.['message']);
      const limited = intakeLimitResponse(databaseMessage);
      if (limited) return json({ error: limited.message }, limited.status, cors);
      console.error('Installation intake insert failed.', inserted);
      return json({ error: 'We could not save your request. Please try again.' }, 502, cors);
    }

    const intakeId = typeof inserted === 'string' ? inserted : null;
    const notificationSent = await sendNotification({ ...payload, id: intakeId });
    return json({ accepted: true, intakeId, notificationSent }, 201, cors);
  } catch (error) {
    console.error('Installation intake function failed.', error);
    return json({ error: 'Request service is temporarily unavailable. Please try again.' }, 500, cors);
  }
});

function validate(input: {
  requestType: string;
  name: string;
  company: string | null;
  email: string;
  phone: string;
  locationName: string;
  locationLabel: string | null;
  locationNotes: string | null;
  latitude: number;
  longitude: number;
  formStartedAt: number;
}): string | null {
  if (input.requestType !== 'Request installation') return 'Only new installation requests are accepted here.';
  if (input.name.length < 2 || input.name.length > 100) return 'Enter a valid name.';
  if (input.company && input.company.length > 120) return 'Company name is too long.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254) return 'Enter a valid email.';
  if (!/^09\d{9}$/.test(input.phone)) return 'Enter a Philippine mobile number.';
  if (input.locationName.length < 2 || input.locationName.length > 160) return 'Enter a valid site name.';
  if (input.locationLabel && input.locationLabel.length > 500) return 'Selected location is too long.';
  if (input.locationNotes && input.locationNotes.length > 1000) return 'Location notes are too long.';
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) return 'Mark the site on the map.';
  if (
    input.latitude < philippineBounds.minLat ||
    input.latitude > philippineBounds.maxLat ||
    input.longitude < philippineBounds.minLng ||
    input.longitude > philippineBounds.maxLng
  ) return 'Choose a location within the Philippines.';
  if (!Number.isFinite(input.formStartedAt) || Date.now() - input.formStartedAt < 2500) {
    return 'Please review the request before sending it.';
  }
  return null;
}

async function verifyTurnstile(request: Request, token: string): Promise<TurnstileVerification> {
  const origin = request.headers.get('origin');
  const localOrigin = isLocalOrigin(origin);
  if (!TURNSTILE_SECRET_KEY) {
    if (localOrigin && ALLOW_UNVERIFIED_LOCAL_INTAKE) return { ok: true, status: 200, hostname: 'localhost', action: TURNSTILE_ACTION };
    console.error('TURNSTILE_SECRET_KEY is missing.');
    return { ok: false, status: 503, error: 'Request verification is unavailable. Please try again later.' };
  }
  if (!token) return { ok: false, status: 422, error: 'Complete the verification before sending.' };

  const idempotencyKey = crypto.randomUUID();
  let lastFailure: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const body: Record<string, string> = {
        secret: TURNSTILE_SECRET_KEY,
        response: token,
        idempotency_key: idempotencyKey,
      };
      const remoteIp = clientIp(request);
      if (remoteIp) body.remoteip = remoteIp;

      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const result = await readJson(response) as Record<string, unknown> | null;
      if (!response.ok) throw new Error(`Turnstile returned ${response.status}`);
      if (!result?.success) {
        console.warn('Turnstile rejected a submission.', result?.['error-codes']);
        return { ok: false, status: 403, error: 'Verification failed. Please try again.' };
      }

      const metadata = result['metadata'] as Record<string, unknown> | undefined;
      const testingResponse = TURNSTILE_TEST_MODE && metadata?.['result_with_testing_key'] === true;
      const hostname = text(result.hostname);
      const action = text(result.action);
      if (action !== TURNSTILE_ACTION && !testingResponse) {
        console.warn('Turnstile action mismatch.', action);
        return { ok: false, status: 403, error: 'Verification failed. Please try again.' };
      }
      const allowedHostnames = turnstileAllowedHostnames();
      if (allowedHostnames.size && !allowedHostnames.has(hostname) && !testingResponse) {
        console.warn('Turnstile hostname mismatch.', hostname);
        return { ok: false, status: 403, error: 'Verification failed. Please try again.' };
      }
      return { ok: true, status: 200, hostname, action };
    } catch (error) {
      lastFailure = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error('Turnstile verification unavailable.', lastFailure);
  return { ok: false, status: 503, error: 'Verification is temporarily unavailable. Please try again.' };
}

function intakeLimitResponse(code: string): { message: string; status: number } | null {
  if (code.includes('recent_email_intake')) {
    return { message: 'A request from this email was submitted recently. Please wait before trying again.', status: 429 };
  }
  if (code.includes('duplicate_installation_intake')) {
    return { message: 'This installation request has already been received.', status: 409 };
  }
  if (code.includes('daily_email_intake_limit')) {
    return { message: 'Too many requests were submitted from this email. Please try again tomorrow.', status: 429 };
  }
  if (code.includes('hourly_ip_intake_limit')) {
    return { message: 'Too many requests were submitted. Please try again later.', status: 429 };
  }
  return null;
}

async function sendNotification(request: Record<string, unknown>): Promise<boolean> {
  if (!RESEND_API_KEY || !NOTIFICATION_EMAIL || !FROM_EMAIL) return false;
  const mapUrl = String(request.osm_url);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [NOTIFICATION_EMAIL],
      subject: `New ExcaVision installation intake: ${String(request.location_name)}`,
      html: `<h2>New installation intake</h2>
        <p><strong>Site:</strong> ${escapeHtml(request.location_name)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(request.name)}<br>${escapeHtml(request.email)}<br>${escapeHtml(request.phone)}</p>
        <p><a href="${escapeHtml(mapUrl)}">Open site location</a></p>`,
    }),
  });
  if (!response.ok) console.error('Notification email failed.', await response.text());
  return response.ok;
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
    const configured = publicSiteOrigins();
    return configured.includes(origin);
  } catch {
    return false;
  }
}

function publicSiteOrigins(): string[] {
  return (Deno.env.get('PUBLIC_SITE_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function turnstileAllowedHostnames(): Set<string> {
  const configured = (Deno.env.get('TURNSTILE_ALLOWED_HOSTNAMES') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  for (const origin of publicSiteOrigins()) {
    try {
      configured.push(new URL(origin).hostname.toLowerCase());
    } catch {
      // Invalid configured origins are rejected by originAllowed.
    }
  }
  return new Set(configured);
}

function isLocalOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || null;
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') ?? 'null';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
}

function serviceHeaders(prefer?: string): Record<string, string> {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function normalizePhone(value: unknown): string {
  let digits = text(value).replace(/\D/g, '');
  if (digits.startsWith('63')) digits = `0${digits.slice(2)}`;
  return digits;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson(response: Response): Promise<unknown> {
  const textBody = await response.text();
  if (!textBody) return null;
  try {
    return JSON.parse(textBody);
  } catch {
    return null;
  }
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
