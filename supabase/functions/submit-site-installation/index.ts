// WBS 2.0 — Manage Requests: validate and persist public installation intake.
const allowedOrigins = (Deno.env.get("PUBLIC_LANDING_ORIGINS") ?? Deno.env.get("PUBLIC_LANDING_ORIGIN") ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "",
    "Access-Control-Allow-Headers": "content-type, x-turnstile-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const emailPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const phonePattern = /^09\d{9}$/;

function response(status: number, body: Record<string, unknown>, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(form: FormData, key: string, max: number) {
  return String(form.get(key) ?? "").trim().slice(0, max);
}

async function hasValidImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") return bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  if (file.type === "image/webp") return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (file.type === "image/heic" || file.type === "image/heif") return new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  return false;
}

async function keyedHash(value: string) {
  const secret = Deno.env.get("ABUSE_HASH_SECRET");
  if (!secret) throw new Error("ABUSE_HASH_SECRET is not configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readError(res: Response) {
  try {
    const body = await res.json();
    return String(body?.message ?? body?.error ?? JSON.stringify(body));
  } catch {
    return String(await res.text());
  }
}

Deno.serve(async (request) => {
  const origin = (request.headers.get("origin") ?? "").replace(/\/$/, "");
  const respond = (status: number, body: Record<string, unknown>) => response(status, body, origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed" });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 27 * 1024 * 1024) return respond(413, { error: "Request is too large" });
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return respond(415, { error: "Multipart form data is required" });

  const allowedOrigin = allowedOrigins.find((candidate) => candidate === origin) ?? "";
  if (!allowedOrigin) return respond(403, { error: "Origin is not allowed" });

  const form = await request.formData();
  if (text(form, "website", 200)) return respond(202, { accepted: true });

  const requester_name = text(form, "requester_name", 80);
  const company_name = text(form, "company_name", 120);
  const contact_email = text(form, "contact_email", 254).toLowerCase();
  const contact_phone = text(form, "contact_phone", 20).replace(/\D/g, "");
  const site_name = text(form, "site_name", 120);
  const address_label = text(form, "address_label", 500);
  const details = text(form, "details", 2000);
  const requestedUnitsRaw = text(form, "requested_units", 12000);
  const latitude = Number(form.get("latitude"));
  const longitude = Number(form.get("longitude"));
  const allowUnverified = Deno.env.get("ALLOW_UNVERIFIED_LOCAL_INTAKE") === "true";
  const expectedAction = "site_installation";
  const turnstileToken = request.headers.get("x-turnstile-token") || text(form, "cf-turnstile-response", 2048) || text(form, "turnstile_token", 2048);
  const files = form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);

  let requested_units: Array<{ name: string; nodes: number }> = [];
  try {
    const parsed = JSON.parse(requestedUnitsRaw) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20) throw new Error("invalid_units");
    requested_units = parsed.map((item) => {
      if (!item || typeof item !== "object") throw new Error("invalid_unit");
      const record = item as { name?: unknown; nodes?: unknown };
      const name = String(record.name ?? "").trim().slice(0, 120);
      const nodes = Number(record.nodes);
      if (!name || !Number.isInteger(nodes) || nodes < 1 || nodes > 16) throw new Error("invalid_unit");
      return { name, nodes };
    });
  } catch {
    return respond(422, { error: "Monitoring unit information is invalid" });
  }
  if (!requester_name || !emailPattern.test(contact_email) || !phonePattern.test(contact_phone)) return respond(422, { error: "Contact information is invalid" });
  if (!site_name || !address_label || latitude < 4.2 || latitude > 21.5 || longitude < 116.5 || longitude > 127) return respond(422, { error: "Site information is invalid" });
  if (files.length > 5 || files.some((file) => file.size > 5 * 1024 * 1024 || !allowedMimeTypes.has(file.type))) return respond(422, { error: "Attachments are invalid" });
  for (const file of files) if (!(await hasValidImageSignature(file))) return respond(422, { error: "An attachment is not a valid image" });
  if (!allowUnverified && !turnstileToken) return respond(422, { error: "Human verification is required" });

  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const expectedHostname = new URL(allowedOrigin).hostname;
  let verifiedHostname: string | undefined;
  if (allowUnverified) {
    verifiedHostname = expectedHostname;
  } else {
    const verificationBody = new URLSearchParams({
      secret: Deno.env.get("TURNSTILE_SECRET") ?? "",
      response: turnstileToken,
    });
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: verificationBody });
    const turnstile = await verification.json() as { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };
    const errorCodes = turnstile["error-codes"] ?? [];
    if (!turnstile.success || turnstile.action !== expectedAction || turnstile.hostname !== expectedHostname) {
      console.error("Turnstile verification rejected", { success: turnstile.success, action: turnstile.action, hostname: turnstile.hostname, expectedAction, expectedHostname, errorCodes });
      return respond(403, { error: "Human verification failed" });
    }
    verifiedHostname = turnstile.hostname;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const restHeaders = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${secretKey}`,
    apikey: secretKey,
    "Content-Type": "application/json",
    ...extra,
  });

  const ip_hash = await keyedHash(forwarded);
  const fingerprintSource = `${contact_email}|${contact_phone}|${site_name.toLowerCase()}|${latitude.toFixed(3)}|${longitude.toFixed(3)}`;
  const submission_fingerprint = await keyedHash(fingerprintSource);

  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_public_intake`, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify({
      target_ip_hash: ip_hash,
      target_fingerprint: submission_fingerprint,
      target_hostname: verifiedHostname ?? "",
    }),
  });
  if (!rpcRes.ok) {
    const message = await readError(rpcRes);
    if (message.includes("rate_limit")) return respond(429, { error: "Too many requests. Try again later" });
    if (message.includes("duplicate_request")) return respond(409, { error: "A matching request was already received" });
    return respond(500, { error: "Request could not be checked" });
  }
  const abuseSignalId = Number(await rpcRes.text());
  const releaseReservation = () => fetch(`${supabaseUrl}/rest/v1/request_abuse_signals?id=eq.${abuseSignalId}`, { method: "DELETE", headers: restHeaders() });

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/service_requests`, {
    method: "POST",
    headers: restHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      request_type: "site_installation",
      status: "open",
      requester_id: null,
      requester_name,
      company_name,
      contact_email,
      contact_phone,
      site_id: null,
      site_name,
      address_label,
      latitude,
      longitude,
      details,
      requested_units,
    }),
  });
  if (!insertRes.ok) {
    await releaseReservation();
    return respond(500, { error: "Request could not be saved" });
  }
  const inserted = await insertRes.json();
  const serviceRequest = (Array.isArray(inserted) ? inserted[0] : inserted) as { id?: string } | undefined;
  if (!serviceRequest?.id) {
    await releaseReservation();
    return respond(500, { error: "Request could not be saved" });
  }

  const uploadedPaths: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" } as Record<string, string>)[file.type];
      const storage_path = `${serviceRequest.id}/${crypto.randomUUID()}-${index}.${extension}`;
      const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/request-attachments/${storage_path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          apikey: secretKey,
          "Content-Type": file.type,
          "x-upsert": "false",
        },
        body: await file.arrayBuffer(),
      });
      if (!uploadRes.ok) throw new Error("upload");
      uploadedPaths.push(storage_path);
      const attachmentRes = await fetch(`${supabaseUrl}/rest/v1/request_attachments`, {
        method: "POST",
        headers: restHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          request_id: serviceRequest.id,
          file_name: file.name.slice(0, 255),
          storage_path,
          mime_type: file.type,
          size_bytes: file.size,
        }),
      });
      if (!attachmentRes.ok) throw new Error("attachment");
    }

    const linkRes = await fetch(`${supabaseUrl}/rest/v1/request_abuse_signals?id=eq.${abuseSignalId}`, {
      method: "PATCH",
      headers: restHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ request_id: serviceRequest.id }),
    });
    if (!linkRes.ok) throw new Error("link");
  } catch {
    if (uploadedPaths.length) {
      await fetch(`${supabaseUrl}/storage/v1/object/request-attachments`, {
        method: "DELETE",
        headers: restHeaders(),
        body: JSON.stringify({ prefixes: uploadedPaths }),
      });
    }
    await fetch(`${supabaseUrl}/rest/v1/service_requests?id=eq.${serviceRequest.id}`, { method: "DELETE", headers: restHeaders() });
    await releaseReservation();
    return respond(500, { error: "Request could not be completed" });
  }

  return respond(201, { accepted: true, request_id: serviceRequest.id });
});
