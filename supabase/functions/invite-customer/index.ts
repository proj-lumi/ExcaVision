const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const CUSTOMER_APP_URL = Deno.env.get('CUSTOMER_APP_URL') ?? '';

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors);
  if (!originAllowed(request)) return json({ error: 'Origin not allowed.' }, 403, cors);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !CUSTOMER_APP_URL) {
    console.error('Customer invitation environment is incomplete.');
    return json({ error: 'Invitation service is unavailable.' }, 503, cors);
  }

  const bearer = request.headers.get('authorization');
  if (!bearer?.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401, cors);

  try {
    const admin = await authenticatedAdmin(bearer);
    if (!admin) return json({ error: 'Admin access required.' }, 403, cors);

    const input = await request.json() as Record<string, unknown>;
    const siteId = text(input.siteId);
    const email = text(input.email).toLowerCase();
    const fullName = text(input.fullName);
    const phone = normalizePhone(input.phone);
    const company = optionalText(input.company);

    if (!isUuid(siteId)) return json({ error: 'Choose a valid site.' }, 422, cors);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Enter a valid email.' }, 422, cors);
    if (fullName.length < 2 || fullName.length > 100) return json({ error: 'Enter a valid customer name.' }, 422, cors);
    if (!/^09\d{9}$/.test(phone)) return json({ error: 'Enter a Philippine mobile number.' }, 422, cors);
    if (company && company.length > 120) return json({ error: 'Company name is too long.' }, 422, cors);

    const site = await fetchOne(`sites?select=id,name&id=eq.${encodeURIComponent(siteId)}`);
    if (!site) return json({ error: 'Site not found.' }, 404, cors);

    const readyUnits = await fetchRows(`pipes?select=id&site_id=eq.${encodeURIComponent(siteId)}&deployment_status=eq.ready&cancelled_at=is.null&limit=1`);
    if (!readyUnits.length) return json({ error: 'Activate monitoring before inviting the customer.' }, 409, cors);

    const linkedProfiles = await fetchRows(`profiles?select=id,email&site_id=eq.${encodeURIComponent(siteId)}&role=eq.customer&limit=1`);
    if (linkedProfiles.length) return json({ error: 'This site already has a customer account.' }, 409, cors);

    const existingEmail = await fetchRows(`profiles?select=id,site_id&email=eq.${encodeURIComponent(email)}&limit=1`);
    if (existingEmail.length) return json({ error: 'This email already has an account. Contact support to change its site.' }, 409, cors);

    const redirectTo = new URL('/auth/confirm', CUSTOMER_APP_URL).toString();
    const invitationResponse = await fetch(`${SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        email,
        data: { full_name: fullName, phone, company, invited_site_name: site.name },
      }),
    });
    const invitation = await readJson(invitationResponse) as Record<string, unknown> | null;
    if (!invitationResponse.ok) {
      console.error('Supabase invitation failed.', invitation);
      const message = invitationResponse.status === 422
        ? 'This email cannot be invited. It may already have an account.'
        : 'The invitation email could not be sent.';
      return json({ error: message }, invitationResponse.status === 422 ? 409 : 502, cors);
    }

    const userId = text(invitation?.id);
    if (!isUuid(userId)) {
      console.error('Invitation response did not contain a user ID.', invitation);
      return json({ error: 'The invitation was sent but account linking failed. Contact support.' }, 502, cors);
    }

    const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
      method: 'POST',
      headers: serviceHeaders('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify({
        id: userId,
        role: 'customer',
        site_id: siteId,
        email,
        full_name: fullName,
        phone,
        company,
        invited_at: new Date().toISOString(),
        invited_by: admin.id,
      }),
    });
    if (!profileResponse.ok) {
      console.error('Invited profile linking failed.', await profileResponse.text());
      await deleteInvitedUser(userId);
      return json({ error: 'Account linking failed. No customer access was created.' }, 502, cors);
    }

    return json({ invited: true, email, siteName: site.name }, 201, cors);
  } catch (error) {
    console.error('Customer invitation failed.', error);
    return json({ error: 'Invitation service is temporarily unavailable.' }, 500, cors);
  }
});

async function authenticatedAdmin(bearer: string): Promise<{ id: string } | null> {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: bearer },
  });
  const user = await readJson(userResponse) as Record<string, unknown> | null;
  const userId = text(user?.id);
  if (!userResponse.ok || !isUuid(userId)) return null;

  const profiles = await fetchRows(`profiles?select=id&role=eq.admin&id=eq.${encodeURIComponent(userId)}&limit=1`);
  return profiles.length ? { id: userId } : null;
}

async function fetchOne(path: string): Promise<Record<string, unknown> | null> {
  const rows = await fetchRows(`${path}&limit=1`);
  return rows[0] ?? null;
}

async function fetchRows(path: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: serviceHeaders() });
  const body = await readJson(response);
  if (!response.ok) throw new Error(`Database lookup failed with ${response.status}.`);
  return Array.isArray(body) ? body as Record<string, unknown>[] : [];
}

async function deleteInvitedUser(userId: string): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  });
  if (!response.ok) console.error('Unable to roll back invited auth user.', await response.text());
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
    return (Deno.env.get('ADMIN_SITE_ORIGINS') ?? '').split(',').map((value) => value.trim()).includes(origin);
  } catch {
    return false;
  }
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') ?? 'null';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, x-client-info',
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
  const content = text(value);
  return content || null;
}

function normalizePhone(value: unknown): string {
  let digits = text(value).replace(/\D/g, '');
  if (digits.startsWith('63')) digits = `0${digits.slice(2)}`;
  return digits;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
