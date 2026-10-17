type SubscriptionInput = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

type ParsedSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: string | null;
};

function allowedOrigins() {
  return new Set(
    (Deno.env.get("MOBILE_APP_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins().has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(status: number, body: unknown, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
  });
}

function serviceHeaders() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function validKey(value: unknown, maximumLength: number) {
  const key = typeof value === "string" ? value : "";
  return /^[A-Za-z0-9_-]+$/.test(key) && key.length <= maximumLength ? key : null;
}

function parseSubscription(value: SubscriptionInput): ParsedSubscription | null {
  const endpoint = typeof value.endpoint === "string" ? value.endpoint : "";
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== "https:" || endpoint.length > 2048) return null;

  const p256dh = validKey(value.keys?.p256dh, 512);
  const auth = validKey(value.keys?.auth, 256);
  if (!p256dh || !auth) return null;

  const expiration = value.expirationTime;
  const expirationTime = expiration === null || expiration === undefined
    ? null
    : typeof expiration === "number" && Number.isFinite(expiration) && expiration > 0
      ? new Date(expiration).toISOString()
      : null;
  return { endpoint, p256dh, auth, expirationTime };
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { ...serviceHeaders(), Authorization: authorization },
  });
  if (!response.ok) return null;
  return await response.json() as { id: string };
}

async function hasActiveCustomerProfile(authUserId: string) {
  const response = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/profiles?select=id&auth_user_id=eq.${encodeURIComponent(authUserId)}&role=eq.customer&account_status=eq.active&limit=1`,
    { headers: serviceHeaders() },
  );
  if (!response.ok) throw new Error(`profile lookup failed: ${response.status}`);
  return (await response.json() as { id: string }[]).length === 1;
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return json(403, { error: "Origin is not allowed" }, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST" && request.method !== "DELETE") return json(405, { error: "POST or DELETE required" }, cors);

  try {
    const user = await authenticatedUser(request);
    if (!user || !(await hasActiveCustomerProfile(user.id))) {
      return json(401, { error: "Active customer authentication is required" }, cors);
    }

    const body = await request.json() as { subscription?: SubscriptionInput };
    const subscription = parseSubscription(body.subscription ?? {});
    if (!subscription) return json(422, { error: "Invalid push subscription" }, cors);

    if (request.method === "DELETE") {
      const response = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}&auth_user_id=eq.${encodeURIComponent(user.id)}`,
        { method: "DELETE", headers: serviceHeaders() },
      );
      if (!response.ok) throw new Error(`subscription deletion failed: ${response.status}`);
      return json(200, { enabled: false }, cors);
    }

    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
      method: "POST",
      headers: {
        ...serviceHeaders(),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        auth_user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        expiration_time: subscription.expirationTime,
      }),
    });
    if (!response.ok) throw new Error(`subscription registration failed: ${response.status}`);
    return json(200, { enabled: true }, cors);
  } catch (error) {
    console.error("[push-subscriptions] request failed", error);
    return json(500, { error: "Push notification preference could not be saved" }, cors);
  }
});
