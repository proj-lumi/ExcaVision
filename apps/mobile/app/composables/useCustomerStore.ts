import type { RealtimeChannel } from "@supabase/supabase-js";
import { MAX_REQUEST_ATTACHMENTS, hasValidRequestAttachmentSignature, validateRequestAttachments } from "~/utils/request-attachments";
import type { Database, Json } from "~/types/database.types";
import type {
  AccessibilityPreferences,
  CustomerMockData,
  RequestedUnitSpec,
  RepairUnitReport,
  CustomerStoreState,
  CustomerUnit,
  MonitoringNode,
  Profile,
  SensorReading,
  SensorSnapshot,
  ServiceRequestType,
  TrendPoint,
} from "~/types/mock";

const READING_POINTS_PER_SENSOR = 120;
// The Gateway uploads on change plus a 15 s heartbeat, so a healthy sensor can
// legitimately be quiet for ~15 s. Keep a clear margin before calling it stale.
const NODE_STALE_AFTER_MS = 30_000;
const SENSOR_STALE_AFTER_MS = 30_000;
const REALTIME_RECONNECT_DELAY_MS = 3_000;

type MutationResult<T = undefined> =
  | { ok: true; value?: T }
  | { ok: false; message: string };

function ageMs(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Number.POSITIVE_INFINITY;
}

function sensorReadingStatus(sensor: SensorSnapshot) {
  if (!sensor.last_recorded_at) return "unknown" as const;
  const mostlyFailed = sensor.latest_sample_count === 0
    || sensor.latest_failure_count >= sensor.latest_sample_count;
  return ageMs(sensor.last_recorded_at) > SENSOR_STALE_AFTER_MS || mostlyFailed
    ? "missing" as const
    : "reporting" as const;
}

function effectiveConnectionState(node: MonitoringNode) {
  if (!node.last_seen_at) return "unknown" as const;
  if (ageMs(node.last_seen_at) > NODE_STALE_AFTER_MS) return "offline" as const;
  return node.position === 1 ? "cloud_online" as const : "local_reporting" as const;
}

function rebuildUnitTrend(unit: CustomerUnit) {
  const peakByTime = new Map<string, number>();
  for (const node of unit.nodes) {
    for (const sensor of node.sensors) {
      for (const point of sensor.history) {
        const existing = peakByTime.get(point.recorded_at);
        peakByTime.set(point.recorded_at, existing === undefined
          ? Math.abs(point.value_deg)
          : Math.max(existing, Math.abs(point.value_deg)));
      }
    }
  }
  unit.trend = [...peakByTime.entries()]
    .map(([recorded_at, value_deg]) => ({ recorded_at, value_deg }))
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

function timestampMs(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function preserveNewerTelemetry(previous: CustomerMockData, next: CustomerMockData) {
  const previousUnits = new Map(previous.units.map((unit) => [unit.id, unit]));
  for (const unit of next.units) {
    const previousUnit = previousUnits.get(unit.id);
    if (!previousUnit) continue;
    const previousNodes = new Map(previousUnit.nodes.map((node) => [node.id, node]));
    for (const node of unit.nodes) {
      const previousNode = previousNodes.get(node.id);
      if (!previousNode) continue;
      if (timestampMs(previousNode.last_seen_at) > timestampMs(node.last_seen_at)) {
        node.last_seen_at = previousNode.last_seen_at;
      }
      const previousSensors = new Map(previousNode.sensors.map((sensor) => [sensor.id, sensor]));
      for (const sensor of node.sensors) {
        const previousSensor = previousSensors.get(sensor.id);
        if (!previousSensor) continue;
        if (timestampMs(previousSensor.last_recorded_at) > timestampMs(sensor.last_recorded_at)) {
          sensor.current_value_deg = previousSensor.current_value_deg;
          sensor.last_recorded_at = previousSensor.last_recorded_at;
          sensor.latest_sample_count = previousSensor.latest_sample_count;
          sensor.latest_failure_count = previousSensor.latest_failure_count;
          const points = new Map([
            ...sensor.history.map((point) => [point.recorded_at, point] as const),
            ...previousSensor.history.map((point) => [point.recorded_at, point] as const),
          ]);
          sensor.history = [...points.values()]
            .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
            .slice(-READING_POINTS_PER_SENSOR);
        }
        sensor.reading_status = sensorReadingStatus(sensor);
      }
      node.connection_state = effectiveConnectionState(node);
    }
    rebuildUnitTrend(unit);
  }
}

export function useCustomerStore() {
  const supabase = useSupabaseClient<Database>();
  const toast = useAppToast();
  const state = useState<CustomerStoreState>("excavision-customer-store-v4", () => ({
    status: "idle",
    data: null,
    error: null,
  }));
  const data = computed(() => state.value.data);
  const isLoading = computed(() => state.value.status === "idle" || (state.value.status === "pending" && !state.value.data));
  let realtimeChannel: RealtimeChannel | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function refreshLiveness() {
    const current = state.value.data;
    if (!current) return;
    for (const unit of current.units) {
      for (const node of unit.nodes) {
        node.connection_state = effectiveConnectionState(node);
        for (const sensor of node.sensors) {
          sensor.reading_status = sensorReadingStatus(sensor);
        }
      }
    }
  }

  function applyReading(reading: SensorReading) {
    const current = state.value.data;
    if (!current) return;
    for (const unit of current.units) {
      for (const node of unit.nodes) {
        const sensor = node.sensors.find((item) => item.id === reading.sensor_id);
        if (!sensor) continue;
        if (sensor.last_recorded_at && new Date(reading.recorded_at).getTime() < new Date(sensor.last_recorded_at).getTime()) return;
        const point = { recorded_at: reading.recorded_at, value_deg: reading.tilt_deg };
        const existingIndex = sensor.history.findIndex((item) => item.recorded_at === reading.recorded_at);
        if (existingIndex >= 0) sensor.history[existingIndex] = point;
        else sensor.history.push(point);
        sensor.history.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
        if (sensor.history.length > READING_POINTS_PER_SENSOR) {
          sensor.history.splice(0, sensor.history.length - READING_POINTS_PER_SENSOR);
        }
        sensor.current_value_deg = reading.tilt_deg;
        sensor.last_recorded_at = reading.recorded_at;
        sensor.latest_sample_count = reading.sample_count;
        sensor.latest_failure_count = reading.failure_count;
        sensor.reading_status = sensorReadingStatus(sensor);
        if (!node.last_seen_at || new Date(reading.recorded_at).getTime() >= new Date(node.last_seen_at).getTime()) {
          node.last_seen_at = reading.recorded_at;
        }
        node.connection_state = effectiveConnectionState(node);
        rebuildUnitTrend(unit);
        return;
      }
    }
  }

  async function load(force = false, background = false) {
    if (state.value.status === "pending") return;
    if (!force && state.value.status === "success") return;

    const previousData = state.value.data;
    state.value = {
      status: "pending",
      data: background ? previousData : null,
      error: null,
    };

    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authUser) throw new Error("Not signed in.");

      const [profileRes, siteRes, unitsRes, nodesRes, sensorsRes, readingsRes, thresholdsRes, anomaliesRes] = await Promise.all([
        supabase.from("profiles").select("id,auth_user_id,role,full_name,email,phone,company_name,account_status,created_at,updated_at").maybeSingle(),
        supabase.from("sites").select("id,slug,name,address_label,latitude,longitude,company_name,customer_id,source_request_id,invitation_status,invitation_sent_at,archived_at,created_at,updated_at").limit(1).maybeSingle(),
        supabase.from("units").select("id,slug,site_id,name,status,alert_threshold_deg,archived_at,created_at,updated_at").is("archived_at", null),
        supabase.from("nodes").select("id,mac_address,status,unit_id,position,connection_state,last_seen_at,archived_at,source_request_id,created_at,updated_at").neq("status", "archived"),
        supabase.from("sensors").select("id,node_id,position,hardware_channel,label,created_at"),
        supabase.rpc("get_customer_recent_readings", { points_per_sensor: READING_POINTS_PER_SENSOR }),
        supabase.from("threshold_events").select("id,unit_id,sensor_id,observed_value_deg,threshold_deg,detected_at,acknowledged_at").order("detected_at", { ascending: false }).limit(200),
        supabase.from("anomaly_events").select("id,unit_id,node_id,sensor_id,detection_method,observed_value_deg,baseline_value_deg,anomaly_score,anomalous_readings,window_size,model_version,window_started_at,detected_at,acknowledged_at").order("detected_at", { ascending: false }).limit(200),
      ]);

      const queryError = [profileRes, siteRes, unitsRes, nodesRes, sensorsRes, readingsRes, thresholdsRes, anomaliesRes]
        .find((result) => result.error)?.error;
      if (queryError) throw queryError;

      const profile = profileRes.data as Profile | null;
      if (!profile) throw new Error("No profile is linked to this account.");
      if (!siteRes.data) throw new Error("No site is linked to this account yet.");

      const readingsBySensor = new Map<string, SensorReading[]>();
      for (const reading of (readingsRes.data ?? []) as SensorReading[]) {
        const list = readingsBySensor.get(reading.sensor_id) ?? [];
        list.push(reading);
        readingsBySensor.set(reading.sensor_id, list);
      }

      const sensorsByNode = new Map<string, SensorSnapshot[]>();
      for (const sensor of sensorsRes.data ?? []) {
        const readings = (readingsBySensor.get(sensor.id) ?? [])
          .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
        const latest = readings.at(-1);
        const snapshot: SensorSnapshot = {
          ...sensor,
          reading_status: "unknown",
          current_value_deg: latest?.tilt_deg ?? null,
          last_recorded_at: latest?.recorded_at ?? null,
          latest_sample_count: latest?.sample_count ?? 0,
          latest_failure_count: latest?.failure_count ?? 0,
          history: readings.map(({ recorded_at, tilt_deg }) => ({ recorded_at, value_deg: tilt_deg })),
        };
        snapshot.reading_status = sensorReadingStatus(snapshot);
        const list = sensorsByNode.get(sensor.node_id) ?? [];
        list.push(snapshot);
        sensorsByNode.set(sensor.node_id, list);
      }

      const nodesByUnit = new Map<string, MonitoringNode[]>();
      for (const rawNode of nodesRes.data ?? []) {
        if (!rawNode.unit_id) continue;
        const node: MonitoringNode = {
          ...rawNode,
          connection_state: rawNode.connection_state,
          sensors: (sensorsByNode.get(rawNode.id) ?? []).sort((a, b) => a.position - b.position),
        };
        node.connection_state = effectiveConnectionState(node);
        const list = nodesByUnit.get(rawNode.unit_id) ?? [];
        list.push(node);
        nodesByUnit.set(rawNode.unit_id, list);
      }

      const customerUnits: CustomerUnit[] = (unitsRes.data ?? []).map((unit) => {
        const customerUnit: CustomerUnit = {
          ...unit,
          source_request_id: null,
          source_request_unit_index: null,
          trend: [],
          nodes: (nodesByUnit.get(unit.id) ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
        };
        rebuildUnitTrend(customerUnit);
        return customerUnit;
      });

      const next: CustomerMockData = {
        profile,
        site: siteRes.data,
        units: customerUnits,
        threshold_events: thresholdsRes.data ?? [],
        anomaly_events: anomaliesRes.data ?? [],
      };
      if (background && previousData) preserveNewerTelemetry(previousData, next);
      state.value = { status: "success", data: next, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Monitoring data could not be loaded.";
      if (background && previousData) {
        state.value = { status: "success", data: previousData, error: null };
        console.warn("Background monitoring refresh failed", error);
        return;
      }
      state.value = { status: "error", data: null, error: message };
    }
  }

  function upsertEvent<T extends { id: string }>(collection: T[], value: T) {
    const index = collection.findIndex((item) => item.id === value.id);
    if (index >= 0) collection[index] = value;
    else collection.unshift(value);
    if (collection.length > 200) collection.length = 200;
  }

  function scheduleRealtimeReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = undefined;
      const channel = realtimeChannel;
      realtimeChannel = null;
      if (channel) await supabase.removeChannel(channel);
      startRealtime();
      void load(true, true);
    }, REALTIME_RECONNECT_DELAY_MS);
  }

  function startRealtime() {
    if (realtimeChannel) return;
    realtimeChannel = supabase
      .channel("customer-live-state")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sensor_readings" }, (payload) => {
        applyReading(payload.new as SensorReading);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "nodes" }, (payload) => {
        const row = payload.new as MonitoringNode;
        const current = state.value.data;
        if (!current) return;
        for (const unit of current.units) {
          const node = unit.nodes.find((item) => item.id === row.id);
          if (!node) continue;
          const currentLastSeen = node.last_seen_at;
          Object.assign(node, row, { sensors: node.sensors });
          if (currentLastSeen && (!row.last_seen_at || new Date(currentLastSeen).getTime() > new Date(row.last_seen_at).getTime())) {
            node.last_seen_at = currentLastSeen;
          }
          node.connection_state = effectiveConnectionState(node);
          return;
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "units" }, (payload) => {
        const row = payload.new as CustomerUnit;
        const unit = state.value.data?.units.find((item) => item.id === row.id);
        if (unit) Object.assign(unit, row, { nodes: unit.nodes, trend: unit.trend });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "threshold_events" }, (payload) => {
        if (payload.eventType !== "DELETE" && state.value.data) {
          upsertEvent(state.value.data.threshold_events, payload.new as CustomerMockData["threshold_events"][number]);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "anomaly_events" }, (payload) => {
        if (payload.eventType !== "DELETE" && state.value.data) {
          upsertEvent(state.value.data.anomaly_events, payload.new as CustomerMockData["anomaly_events"][number]);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleRealtimeReconnect();
        }
      });
  }

  async function stopRealtime() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (!realtimeChannel) return;
    const channel = realtimeChannel;
    realtimeChannel = null;
    await supabase.removeChannel(channel);
  }

  // WBS 6.0 — Monitor Sites: customer fixed-threshold configuration.
  async function updateThreshold(id: string, value: number): Promise<MutationResult> {
    const { error } = await supabase.rpc("update_unit_threshold", {
      target_unit_id: id,
      new_threshold_deg: value,
    });
    if (error) return { ok: false, message: error.message };
    const unit = state.value.data?.units.find((item) => item.id === id);
    if (unit) {
      unit.alert_threshold_deg = value;
      unit.updated_at = new Date().toISOString();
    }
    return { ok: true };
  }

  async function acknowledgeThresholdEvent(id: string): Promise<MutationResult> {
    const { error } = await supabase.rpc("acknowledge_threshold_event", { target_event_id: id });
    if (error) return { ok: false, message: error.message };
    const event = state.value.data?.threshold_events.find((item) => item.id === id);
    if (event) event.acknowledged_at = new Date().toISOString();
    return { ok: true };
  }

  async function acknowledgeAnomalyEvent(id: string): Promise<MutationResult> {
    const { error } = await supabase.rpc("acknowledge_anomaly_event", { target_event_id: id });
    if (error) return { ok: false, message: error.message };
    const event = state.value.data?.anomaly_events.find((item) => item.id === id);
    if (event) event.acknowledged_at = new Date().toISOString();
    return { ok: true };
  }

  // WBS 2.0 — Manage Requests: shared customer service-request submission.
  async function submitCustomerRequest(
    request_type: Extract<ServiceRequestType, "repair" | "add_nodes" | "add_unit">,
    details: string,
    attachments: File[] = [],
    targetUnitId?: string,
    requestedCount?: number,
    requestedUnits?: RequestedUnitSpec[],
    repairReport?: RepairUnitReport,
  ): Promise<string | null> {
    const current = state.value.data;
    if (!current) return null;
    const attachmentError = validateRequestAttachments(attachments);
    if (attachmentError) {
      toast.add({ title: "Request not sent", description: attachmentError, color: "error" });
      return null;
    }
    if (!(await Promise.all(attachments.map(hasValidRequestAttachmentSignature))).every(Boolean)) {
      toast.add({ title: "Request not sent", description: "One photo is not a valid image. Try another.", color: "error" });
      return null;
    }
    const rpcArgs = {
      target_site_id: current.site.id,
      target_request_type: request_type,
      target_details: details,
      ...(requestedCount ? {
        target_unit_id: targetUnitId ?? null,
        target_requested_count: requestedCount,
        target_requested_units: (requestedUnits ?? null) as Json,
      } : targetUnitId ? { target_unit_id: targetUnitId } : {}),
      ...(repairReport ? {
        target_unit_id: targetUnitId ?? null,
        target_requested_count: null,
        target_requested_units: null,
        target_repair_report: repairReport as unknown as Json,
      } : {}),
    };
    const { data: requestId, error } = await supabase.rpc("submit_customer_request", rpcArgs);
    if (error || !requestId) {
      toast.add({ title: "Request not sent", description: error?.message ?? "Request could not be created.", color: "error" });
      return null;
    }

    const attachmentRows: Database["public"]["Tables"]["request_attachments"]["Insert"][] = [];
    for (const [index, file] of attachments.slice(0, MAX_REQUEST_ATTACHMENTS).entries()) {
      const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
      const path = `${requestId}/${crypto.randomUUID()}-${index}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("request-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        toast.add({ title: "Photo not uploaded", description: uploadError.message, color: "error" });
        continue;
      }
      attachmentRows.push({
        request_id: requestId,
        file_name: file.name.slice(0, 255),
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
      });
    }
    if (attachmentRows.length) {
      const { error: attachmentError } = await supabase.from("request_attachments").insert(attachmentRows);
      if (attachmentError) {
        toast.add({ title: "Attachments not saved", description: attachmentError.message, color: "error" });
      }
    }
    return requestId;
  }

  async function updateProfile(
    input: Pick<Profile, "full_name" | "email" | "phone" | "company_name">,
  ): Promise<MutationResult<Profile>> {
    const current = state.value.data;
    if (!current) return { ok: false, message: "Profile is unavailable." };
    const { data: updated, error } = await supabase
      .from("profiles")
      .update(input)
      .eq("id", current.profile.id)
      .select("id,auth_user_id,role,full_name,email,phone,company_name,account_status,created_at,updated_at")
      .single();
    if (error) return { ok: false, message: error.message };
    current.profile = updated;
    current.site.company_name = updated.company_name;
    return { ok: true, value: updated };
  }

  return {
    state: readonly(state),
    data,
    isLoading,
    load,
    refresh: () => load(true),
    backgroundRefresh: () => load(true, true),
    refreshLiveness,
    startRealtime,
    stopRealtime,
    updateThreshold,
    acknowledgeThresholdEvent,
    acknowledgeAnomalyEvent,
    submitCustomerRequest,
    updateProfile,
  };
}

export function useAccessibilityPreferences() {
  return useCookie<AccessibilityPreferences>("excavision-accessibility-v2", {
    default: () => ({ large_telemetry: false, reduce_motion: false }),
    sameSite: "lax",
  });
}
