import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Database } from "~/types/database.types";
import { parseRequestedUnitSpecs } from "~/types/mock";
import type {
  AdminMockData,
  InvitationInput,
  Node,
  Profile,
  ServiceRequest,
  ServiceRequestStatus,
  Site,
  Unit,
  UnitInput,
} from "~/types/mock";

type MutationResult<T = undefined> =
  | { ok: true; value?: T }
  | { ok: false; message: string };

type RegisteredNode = { node: Node };
type ApprovedResources = { site_id: string; unit_ids: string[] };
type InvitationDelivery = { local_inbox_url: string | null };

const profileColumns = "id,auth_user_id,role,full_name,email,phone,company_name,account_status,created_at,updated_at";
const requestColumns = "id,request_type,status,requester_id,requester_name,company_name,contact_email,contact_phone,site_id,target_unit_id,requested_count,requested_nodes_per_unit,requested_units,repair_report,site_name,address_label,latitude,longitude,details,setup_step,submitted_at,completed_at";
const attachmentColumns = "id,request_id,file_name,storage_path,mime_type,size_bytes,created_at";
const siteColumns = "id,slug,name,address_label,latitude,longitude,company_name,customer_id,source_request_id,invitation_status,invitation_sent_at,archived_at,created_at,updated_at";
const unitColumns = "id,slug,site_id,name,status,alert_threshold_deg,source_request_id,source_request_unit_index,archived_at,created_at,updated_at";
const nodeColumns = "id,mac_address,status,unit_id,position,connection_state,last_seen_at,archived_at,source_request_id,created_at,updated_at";

function emptyData(): AdminMockData {
  return {
    current_profile_id: "",
    profiles: [],
    service_requests: [],
    request_attachments: [],
    sites: [],
    units: [],
    nodes: [],
    sensors: [],
    threshold_events: [],
    anomaly_events: [],
  };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueSlug(base: string, existing: string[]) {
  const root = slugify(base) || "record";
  if (!existing.includes(root)) return root;
  let suffix = 2;
  while (existing.includes(`${root}-${suffix}`)) suffix += 1;
  return `${root}-${suffix}`;
}

export function useAdminStore() {
  const supabase = useSupabaseClient<Database>();
  const data = useState<AdminMockData>("excavision-admin-data-v6", emptyData);
  const requestPending = useState("excavision-admin-pending-v2", () => true);
  const loaded = useState("excavision-admin-loaded-v2", () => false);
  const pending = computed(() => requestPending.value && !loaded.value);
  const current_profile = computed(() => data.value.profiles.find((profile) => profile.id === data.value.current_profile_id));
  let realtimeChannel: RealtimeChannel | null = null;

  function applyRealtimeRow<T extends { id: string }>(collection: T[], payload: { eventType: string; new: T; old: T }) {
    if (payload.eventType === "DELETE") {
      const index = collection.findIndex((item) => item.id === payload.old.id);
      if (index >= 0) collection.splice(index, 1);
      return;
    }
    const index = collection.findIndex((item) => item.id === payload.new.id);
    const existing = index >= 0 ? collection[index] : undefined;
    if (existing) Object.assign(existing, payload.new);
    else collection.unshift(payload.new);
  }

  function startRealtime() {
    if (realtimeChannel) return;
    realtimeChannel = supabase
      .channel("admin-live-state")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (payload) => {
        applyRealtimeRow(data.value.profiles, payload as never);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "service_requests" }, (payload) => {
        applyRealtimeRow(data.value.service_requests, payload as never);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sites" }, (payload) => {
        applyRealtimeRow(data.value.sites, payload as never);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "units" }, (payload) => {
        applyRealtimeRow(data.value.units, payload as never);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "nodes" }, (payload) => {
        applyRealtimeRow(data.value.nodes, payload as never);
      })
      .subscribe();
  }

  async function stopRealtime() {
    if (!realtimeChannel) return;
    const channel = realtimeChannel;
    realtimeChannel = null;
    await supabase.removeChannel(channel);
  }

  async function load(force = false): Promise<MutationResult> {
    if (loaded.value && !force) return { ok: true };
    requestPending.value = true;
    try {
      const [{ data: { user: authUser }, error: authError }, profiles, requests, sites, units, nodes] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("profiles").select(profileColumns).limit(500),
        supabase.from("service_requests").select(requestColumns).order("submitted_at", { ascending: false }).limit(500),
        supabase.from("sites").select(siteColumns).order("created_at", { ascending: false }).limit(500),
        supabase.from("units").select(unitColumns).order("created_at", { ascending: false }).limit(1000),
        supabase.from("nodes").select(nodeColumns).order("created_at", { ascending: false }).limit(2000),
      ]);
      const queryError = [authError, profiles.error, requests.error, sites.error, units.error, nodes.error].find(Boolean);
      if (queryError) return { ok: false, message: queryError.message };
      const me = (profiles.data ?? []).find((profile) => profile.auth_user_id === authUser?.id);
      data.value = {
        current_profile_id: me?.id ?? "",
        profiles: profiles.data ?? [],
        service_requests: (requests.data ?? []).map((item) => ({
          ...item,
          requested_units: parseRequestedUnitSpecs(item.requested_units),
          repair_report: item.repair_report as ServiceRequest["repair_report"],
        })),
        request_attachments: [],
        sites: sites.data ?? [],
        units: units.data ?? [],
        nodes: nodes.data ?? [],
        sensors: [],
        threshold_events: [],
        anomaly_events: [],
      };
      loaded.value = true;
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Admin data could not be loaded." };
    } finally {
      requestPending.value = false;
    }
  }

  async function loadRequestAttachments(request_id: string): Promise<MutationResult> {
    const { data: attachments, error } = await supabase
      .from("request_attachments")
      .select(attachmentColumns)
      .eq("request_id", request_id)
      .order("created_at", { ascending: true })
      .limit(5);
    if (error) return { ok: false, message: error.message };
    data.value.request_attachments = [
      ...data.value.request_attachments.filter((attachment) => attachment.request_id !== request_id),
      ...(attachments ?? []),
    ];
    return { ok: true };
  }

  async function setRequestStatus(id: string, status: ServiceRequestStatus): Promise<MutationResult> {
    const request = data.value.service_requests.find((item) => item.id === id);
    if (!request) return { ok: false, message: "This request no longer exists." };
    if (status === "open" && request.status !== "open") return { ok: false, message: "Finished requests cannot be reopened." };
    const completed_at = status === "completed" ? new Date().toISOString() : null;
    const { data: updated, error } = await supabase
      .from("service_requests")
      .update({ status, completed_at })
      .eq("id", id)
      .select(requestColumns)
      .single();
    if (error) return { ok: false, message: error.message };
    Object.assign(request, updated);
    return { ok: true };
  }

  async function setRequestSetupStep(id: string, setup_step: number): Promise<MutationResult> {
    const request = data.value.service_requests.find((item) => item.id === id);
    if (!request) return { ok: false, message: "This request no longer exists." };
    if (!Number.isInteger(setup_step) || setup_step < 0 || setup_step > 8) return { ok: false, message: "Invalid setup step." };
    const { data: updated, error } = await supabase
      .from("service_requests")
      .update({ setup_step })
      .eq("id", id)
      .select(requestColumns)
      .single();
    if (error) return { ok: false, message: error.message };
    Object.assign(request, updated);
    return { ok: true };
  }

  async function approveRequestResources(request_id: string): Promise<MutationResult<ApprovedResources>> {
    const request = data.value.service_requests.find((item) => item.id === request_id);
    if (!request) return { ok: false, message: "This request no longer exists." };
    if (!['site_installation', 'add_unit'].includes(request.request_type)) return { ok: false, message: "This request has no resources to approve." };
    if (request.status !== "open") return { ok: false, message: "Only open requests can be approved." };

    const { data: approved, error } = await supabase.rpc("approve_request_resources", { target_request_id: request_id });
    if (error) return { ok: false, message: error.message };
    const value = approved as unknown as ApprovedResources;
    if (!value?.site_id || !Array.isArray(value.unit_ids)) return { ok: false, message: "Approved resources could not be read." };
    await load(true);
    return { ok: true, value };
  }

  async function createSiteFromRequest(request_id: string, site_name: string): Promise<MutationResult<Site>> {
    const request = data.value.service_requests.find((item) => item.id === request_id);
    if (!request) return { ok: false, message: "This request no longer exists." };
    if (request.request_type !== "site_installation") return { ok: false, message: "Only site installation requests can create sites." };
    if (request.status !== "open") return { ok: false, message: "Only open requests can start setup." };
    if (request.site_id) return { ok: false, message: "A site is already linked to this request." };

    const rpcResult = await supabase.rpc("create_site_from_request", {
      target_request_id: request_id,
      target_site_name: site_name.trim(),
    });
    let newSiteId = rpcResult.data;
    if (rpcResult.error && !rpcResult.error.message.includes("not_completed")) {
      return { ok: false, message: rpcResult.error.message };
    }
    if (rpcResult.error) {
      const existingProfile = data.value.profiles.find((profile) => profile.email.toLowerCase() === request.contact_email.toLowerCase());
      let profileId = existingProfile?.id;
      let createdProfile = false;
      if (!profileId) {
        const { data: profile, error: profileError } = await supabase.from("profiles").insert({
          auth_user_id: null,
          role: "customer",
          full_name: request.requester_name,
          email: request.contact_email,
          phone: request.contact_phone,
          company_name: request.company_name,
          account_status: "pending",
        }).select(profileColumns).single();
        if (profileError || !profile) return { ok: false, message: profileError?.message ?? "Customer could not be created." };
        profileId = profile.id;
        createdProfile = true;
      }
      const slug = uniqueSlug(site_name, data.value.sites.map((site) => site.slug));
      const { data: site, error: siteError } = await supabase.from("sites").insert({
        slug,
        name: site_name.trim(),
        address_label: request.address_label,
        latitude: request.latitude,
        longitude: request.longitude,
        company_name: request.company_name,
        customer_id: profileId,
        source_request_id: request.id,
        invitation_status: "not_invited",
      }).select(siteColumns).single();
      if (siteError || !site) {
        if (createdProfile) await supabase.from("profiles").delete().eq("id", profileId);
        return { ok: false, message: siteError?.message ?? "Site could not be created." };
      }
      const { error: requestError } = await supabase.from("service_requests").update({ site_id: site.id, requester_id: profileId }).eq("id", request.id);
      if (requestError) {
        await supabase.from("sites").delete().eq("id", site.id);
        if (createdProfile) await supabase.from("profiles").delete().eq("id", profileId);
        return { ok: false, message: requestError.message };
      }
      newSiteId = site.id;
    }
    if (!newSiteId) return { ok: false, message: "Site could not be created." };
    await load(true);
    const site = data.value.sites.find((item) => item.id === newSiteId);
    return site ? { ok: true, value: site } : { ok: false, message: "Site created but could not be refreshed." };
  }

  async function archiveNode(id: string): Promise<MutationResult> {
    if (!data.value.nodes.some((node) => node.id === id)) return { ok: false, message: "This node no longer exists." };
    const { error } = await supabase.rpc("archive_node", { target_node_id: id });
    if (error) return { ok: false, message: error.message };
    await load(true);
    return { ok: true };
  }

  async function archiveUnit(id: string): Promise<MutationResult> {
    if (!data.value.units.some((unit) => unit.id === id)) return { ok: false, message: "This unit no longer exists." };
    const { error } = await supabase.rpc("archive_unit", { target_unit_id: id });
    if (error) return { ok: false, message: error.message };
    await load(true);
    return { ok: true };
  }

  async function archiveSite(id: string): Promise<MutationResult> {
    if (!data.value.sites.some((site) => site.id === id)) return { ok: false, message: "This site no longer exists." };
    const { error } = await supabase.rpc("archive_site", { target_site_id: id });
    if (error) return { ok: false, message: error.message };
    await load(true);
    return { ok: true };
  }

  async function addUnit(input: UnitInput): Promise<MutationResult<Unit>> {
    const site = data.value.sites.find((item) => item.id === input.site_id);
    if (!site || site.archived_at) return { ok: false, message: "This site is unavailable." };
    const unit = {
      id: crypto.randomUUID(),
      slug: uniqueSlug(`${site.name} ${input.name}`, data.value.units.map((item) => item.slug)),
      site_id: input.site_id,
      name: input.name.trim(),
      status: "setup_pending" as const,
      alert_threshold_deg: 2,
      archived_at: null,
      source_request_id: input.source_request_id ?? null,
      source_request_unit_index: input.source_request_unit_index ?? null,
    };
    const { data: created, error } = await supabase.from("units").insert(unit).select(unitColumns).single();
    if (error) return { ok: false, message: error.message };
    data.value.units.unshift(created);
    return { ok: true, value: created };
  }

  async function registerNode(mac_address: string): Promise<MutationResult<RegisteredNode>> {
    const { data: result, error } = await supabase.rpc("register_node", { target_mac: mac_address });
    if (error) return { ok: false, message: error.message };
    const registered = result as unknown as RegisteredNode;
    if (!registered?.node?.id) return { ok: false, message: "Node registration returned no node." };
    data.value.nodes.unshift(registered.node);
    return { ok: true, value: registered };
  }

  async function assignNode(node_id: string, unit_id: string): Promise<MutationResult> {
    const { error } = await supabase.rpc("assign_node", { target_node_id: node_id, target_unit_id: unit_id });
    if (error) return { ok: false, message: error.message };
    await load(true);
    return { ok: true };
  }

  async function assignNodeForRequest(node_id: string, request_id: string): Promise<MutationResult> {
    const { error } = await supabase.rpc("assign_node_for_request", { target_node_id: node_id, target_request_id: request_id });
    if (error) return { ok: false, message: error.message };
    await load(true);
    return { ok: true };
  }

  async function assignNodeForAddUnitRequest(node_id: string, request_id: string, unit_id: string): Promise<MutationResult> {
    const { error } = await supabase.rpc("assign_node_for_add_unit_request", { target_node_id: node_id, target_request_id: request_id, target_unit_id: unit_id });
    if (error) return { ok: false, message: error.message };
    await load(true);
    return { ok: true };
  }

  async function reorderUnitNode(node_id: string, target_position: number): Promise<MutationResult> {
    if (!data.value.nodes.some((node) => node.id === node_id && node.status === "assigned")) return { ok: false, message: "This assigned node no longer exists." };
    const { error } = await supabase.rpc("reorder_unit_node", { target_node_id: node_id, target_position });
    if (error) return { ok: false, message: error.message };
    await load(true);
    return { ok: true };
  }

  async function inviteCustomer(site_id: string, input: InvitationInput): Promise<MutationResult<InvitationDelivery>> {
    const site = data.value.sites.find((item) => item.id === site_id);
    if (!site || site.archived_at) return { ok: false, message: "This site is unavailable." };
    const installation = data.value.service_requests.find((request) =>
      request.id === site.source_request_id && request.request_type === "site_installation",
    );
    const installationReady = installation?.status === "completed"
      || (installation?.status === "open" && installation.setup_step >= 2);
    if (!installationReady) return { ok: false, message: "Finish configuring the installation before inviting the customer." };
    if (site.invitation_status === "activated") return { ok: false, message: "This customer has activated their account and cannot be reinvited." };
    try {
      const delivery = await $fetch<InvitationDelivery>("/api/admin/invite", {
        method: "POST",
        body: { site_id, ...input },
      });
      await load(true);
      return { ok: true, value: delivery };
    } catch (error) {
      const typed = error as { data?: { statusMessage?: string }; message?: string };
      return { ok: false, message: typed.data?.statusMessage ?? typed.message ?? "Invitation could not be sent." };
    }
  }

  async function updateProfile(profile_id: string, input: InvitationInput): Promise<MutationResult<Profile>> {
    const profile = data.value.profiles.find((item) => item.id === profile_id);
    if (!profile) return { ok: false, message: "This profile is unavailable." };
    const { data: updated, error } = await supabase
      .from("profiles")
      .update(input)
      .eq("id", profile_id)
      .select(profileColumns)
      .single();
    if (error) return { ok: false, message: error.message };
    Object.assign(profile, updated);
    return { ok: true, value: updated };
  }

  return {
    data,
    pending,
    current_profile,
    load,
    startRealtime,
    stopRealtime,
    loadRequestAttachments,
    setRequestStatus,
    setRequestSetupStep,
    approveRequestResources,
    createSiteFromRequest,
    archiveSite,
    addUnit,
    archiveUnit,
    registerNode,
    assignNode,
    assignNodeForRequest,
    assignNodeForAddUnitRequest,
    reorderUnitNode,
    archiveNode,
    inviteCustomer,
    updateProfile,
  };
}

/** @deprecated Use useAdminStore. Kept temporarily for component migration. */
export const useMockStore = useAdminStore;
