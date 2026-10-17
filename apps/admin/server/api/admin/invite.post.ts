// WBS 3.0 — Set Up Sites: customer invitation after commissioning.
// Sends a customer Auth invite (service_role) and links the resulting auth user to a
// pending customer profile + the site. Called by the Admin client.
import { serverSupabaseServiceRole, serverSupabaseUser } from "#supabase/server";

function expectedNodeCounts(requestedUnits: unknown, requestedCount: number | null, nodesPerUnit: number | null) {
  if (Array.isArray(requestedUnits)) {
    const counts = requestedUnits.map((item) => {
      if (!item || typeof item !== "object" || !("nodes" in item)) return null;
      const count = Number(item.nodes);
      return Number.isInteger(count) && count >= 1 && count <= 16 ? count : null;
    });
    return counts.length > 0 && counts.every((count): count is number => count !== null) ? counts : [];
  }
  if (Number.isInteger(requestedCount) && Number(requestedCount) > 0
    && Number.isInteger(nodesPerUnit) && Number(nodesPerUnit) > 0 && Number(nodesPerUnit) <= 16) {
    return Array.from({ length: Number(requestedCount) }, () => Number(nodesPerUnit));
  }
  return [];
}

export default defineEventHandler(async (event) => {
  const serviceRole = serverSupabaseServiceRole(event);
  const caller = await serverSupabaseUser(event);
  if (!caller) throw createError({ statusCode: 401, statusMessage: "Not signed in." });

  const { data: callerProfile, error: callerError } = await serviceRole
    .from("profiles")
    .select("role")
    .eq("auth_user_id", caller.sub)
    .maybeSingle();
  if (callerError || callerProfile?.role !== "admin") {
    throw createError({ statusCode: 403, statusMessage: "Admin access required." });
  }

  const body = await readBody<{
    site_id: string;
    full_name: string;
    email: string;
    phone: string;
    company_name: string;
    redirect_to?: string;
  }>(event);
  if (!body?.site_id || !body?.full_name || !body?.email) {
    throw createError({ statusCode: 400, statusMessage: "Missing required fields." });
  }

  const { data: site, error: siteError } = await serviceRole
    .from("sites")
    .select("invitation_status,source_request_id")
    .eq("id", body.site_id)
    .maybeSingle();
  if (siteError || !site) throw createError({ statusCode: 404, statusMessage: "Site not found." });

  const { data: installation, error: installationError } = site.source_request_id
    ? await serviceRole
        .from("service_requests")
        .select("id,status,setup_step,requested_units,requested_count,requested_nodes_per_unit")
        .eq("id", site.source_request_id)
        .eq("site_id", body.site_id)
        .eq("request_type", "site_installation")
        .maybeSingle()
    : { data: null, error: null };
  if (installationError) throw createError({ statusCode: 500, statusMessage: installationError.message });

  let installationReady = installation?.status === "completed";
  if (installation?.status === "open" && installation.setup_step >= 2) {
    const nodeCounts = expectedNodeCounts(
      installation.requested_units,
      installation.requested_count,
      installation.requested_nodes_per_unit,
    );
    const { data: units, error: unitsError } = await serviceRole
      .from("units")
      .select("id,status,source_request_unit_index,created_at")
      .eq("site_id", body.site_id)
      .eq("source_request_id", installation.id)
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    if (unitsError) throw createError({ statusCode: 500, statusMessage: unitsError.message });

    installationReady = nodeCounts.length > 0 && units?.length === nodeCounts.length;
    if (installationReady) {
      const indexed = units!.some((unit) => unit.source_request_unit_index !== null);
      for (let index = 0; index < nodeCounts.length && installationReady; index += 1) {
        const unit = indexed
          ? units!.find((item) => item.source_request_unit_index === index)
          : units![index];
        if (!unit || unit.status !== "active") {
          installationReady = false;
          break;
        }
        const { count, error: nodesError } = await serviceRole
          .from("nodes")
          .select("id", { count: "exact", head: true })
          .eq("unit_id", unit.id)
          .eq("status", "assigned")
          .is("archived_at", null);
        if (nodesError) throw createError({ statusCode: 500, statusMessage: nodesError.message });
        if (count !== nodeCounts[index]) installationReady = false;
      }
    }
  }
  if (!installationReady) {
    throw createError({ statusCode: 409, statusMessage: "Finish configuring every requested unit before inviting the customer." });
  }
  if (site.invitation_status === "activated") {
    throw createError({ statusCode: 400, statusMessage: "This customer has activated their account and cannot be reinvited." });
  }

  // Each environment must explicitly choose its customer invitation destination.
  const config = useRuntimeConfig(event);
  const redirectTo = config.inviteRedirectUrl;
  if (!redirectTo) throw createError({ statusCode: 503, statusMessage: "Configure NUXT_INVITE_REDIRECT_URL for this environment." });
  const { data: inviteData, error: inviteError } = await serviceRole.auth.admin.inviteUserByEmail(body.email, { redirectTo });
  if (inviteError) throw createError({ statusCode: 400, statusMessage: inviteError.message });

  const { data: profile, error: profileError } = await serviceRole
    .from("profiles")
    .upsert(
      {
        auth_user_id: inviteData.user.id,
        role: "customer",
        full_name: body.full_name,
        email: body.email,
        phone: body.phone,
        company_name: body.company_name,
        account_status: "pending",
      },
      { onConflict: "email" },
    )
    .select("id")
    .single();
  if (profileError || !profile) {
    throw createError({ statusCode: 500, statusMessage: profileError?.message ?? "Profile could not be saved." });
  }

  const { error: updateError } = await serviceRole
    .from("sites")
    .update({
      customer_id: profile.id,
      company_name: body.company_name,
      invitation_status: "invited",
      invitation_sent_at: new Date().toISOString(),
    })
    .eq("id", body.site_id);
  if (updateError) throw createError({ statusCode: 500, statusMessage: updateError.message });

  return { ok: true, local_inbox_url: config.public.localMailpitUrl || null };
});
