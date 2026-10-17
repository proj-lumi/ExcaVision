export type UserRole = "admin" | "customer";
export type AccountStatus = "pending" | "active" | "disabled";
export type InvitationStatus = "not_invited" | "invited" | "activated";
export type ServiceRequestType = "site_installation" | "add_unit" | "add_nodes" | "repair";
export type ServiceRequestStatus = "open" | "completed" | "spam";
export type UnitStatus = "setup_pending" | "active" | "archived";
export type NodeStatus = "unassigned" | "assigned" | "archived";
export type NodeConnectionState = "cloud_online" | "local_reporting" | "offline" | "unknown";

export interface Profile {
  id: string;
  auth_user_id: string | null;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string;
  company_name: string;
  account_status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: string;
  slug: string;
  name: string;
  address_label: string;
  latitude: number;
  longitude: number;
  company_name: string;
  customer_id: string | null;
  source_request_id: string;
  invitation_status: InvitationStatus;
  invitation_sent_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestedUnitSpec {
  name: string;
  nodes: number;
}

export function parseRequestedUnitSpecs(value: unknown): RequestedUnitSpec[] | null {
  if (!Array.isArray(value)) return null;
  const specs = value.filter((item): item is { name: unknown; nodes: unknown } => Boolean(item) && typeof item === "object" && "name" in item && "nodes" in item)
    .map((item) => ({ name: String(item.name), nodes: Number(item.nodes) }))
    .filter((item) => item.name.trim().length > 0 && Number.isInteger(item.nodes) && item.nodes >= 1 && item.nodes <= 16);
  return specs.length === value.length ? specs : null;
}

export interface Unit {
  id: string;
  slug: string;
  site_id: string;
  name: string;
  status: UnitStatus;
  alert_threshold_deg: number;
  archived_at: string | null;
  source_request_id: string | null;
  source_request_unit_index: number | null;
  created_at: string;
  updated_at: string;
}

export interface Node {
  id: string;
  mac_address: string;
  status: NodeStatus;
  unit_id: string | null;
  position: number | null;
  connection_state: NodeConnectionState;
  last_seen_at: string | null;
  archived_at: string | null;
  source_request_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sensor {
  id: string;
  node_id: string;
  position: number;
  hardware_channel: number | null;
  label: string;
  created_at: string;
}

export interface ServiceRequest {
  id: string;
  request_type: ServiceRequestType;
  status: ServiceRequestStatus;
  requester_id: string | null;
  requester_name: string;
  company_name: string;
  contact_email: string;
  contact_phone: string;
  site_id: string | null;
  target_unit_id: string | null;
  requested_count: number | null;
  requested_nodes_per_unit: number | null;
  requested_units: RequestedUnitSpec[] | null;
  repair_report: RepairUnitReport | null;
  site_name: string;
  address_label: string;
  latitude: number;
  longitude: number;
  details: string;
  setup_step: number;
  submitted_at: string;
  completed_at: string | null;
}

export type RepairSensorDataStatus = "reporting" | "missing" | "unknown";
export type RepairReadingStatus = "Normal" | "Warning" | "Critical" | "No data";
export type RepairHealthStatus = "Healthy" | "Attention";

export interface RepairUnitReport {
  version: 2;
  captured_at: string;
  unit: {
    id: string;
    name: string;
    reading_status: RepairReadingStatus;
    health_status: RepairHealthStatus;
    threshold_deg: number;
  };
  nodes: Array<{
    id: string;
    name: string;
    position: number | null;
    role: string;
    health_status: RepairHealthStatus;
    connection_state: NodeConnectionState;
    last_seen_at: string | null;
    sensors: Array<{
      id: string;
      position: number;
      label: string;
      value_deg: number | null;
      reading_status: RepairSensorDataStatus;
      status: RepairReadingStatus;
      last_recorded_at: string | null;
      sample_count: number;
      failure_count: number;
    }>;
  }>;
}

// Legacy reports remain parseable for historical requests, but new repair
// requests store the structured report in service_requests.repair_report.
export interface LegacyRepairRequestSnapshot {
  version: 1;
  captured_at: string;
  unit: RepairUnitReport["unit"];
  node: Omit<RepairUnitReport["nodes"][number], "sensors">;
  sensors: RepairUnitReport["nodes"][number]["sensors"];
}

const REPAIR_DETAILS_PREFIX = "EXCAVISION_REPAIR_V1:";

export function parseRepairRequestDetails(details: string): { problem: string; snapshot: LegacyRepairRequestSnapshot | null } {
  if (!details.startsWith(REPAIR_DETAILS_PREFIX)) return { problem: details, snapshot: null };
  try {
    const parsed = JSON.parse(details.slice(REPAIR_DETAILS_PREFIX.length)) as { problem?: unknown; snapshot?: LegacyRepairRequestSnapshot };
    if (!parsed.snapshot || parsed.snapshot.version !== 1) return { problem: String(parsed.problem ?? ""), snapshot: null };
    return { problem: String(parsed.problem ?? ""), snapshot: parsed.snapshot };
  } catch {
    return { problem: details, snapshot: null };
  }
}

export interface RequestAttachment {
  id: string;
  request_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface SensorReading {
  id: number;
  sensor_id: string;
  tilt_deg: number;
  gravity_magnitude_g: number | null;
  temperature_c: number | null;
  sample_count: number;
  failure_count: number;
  alert_flag: boolean;
  recorded_at: string;
}

export interface ThresholdEvent {
  id: string;
  unit_id: string;
  sensor_id: string;
  observed_value_deg: number;
  threshold_deg: number;
  detected_at: string;
  acknowledged_at: string | null;
}

export interface AnomalyEvent {
  id: string;
  unit_id: string;
  node_id: string;
  sensor_id: string;
  detection_method: "isolation_forest";
  observed_value_deg: number;
  baseline_value_deg: number;
  anomaly_score: number;
  anomalous_readings: number;
  window_size: number;
  model_version: string;
  window_started_at: string;
  detected_at: string;
  acknowledged_at: string | null;
}

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending: "Pending",
  active: "Active",
  disabled: "Disabled",
};

export function getRequestedCount(request: Pick<ServiceRequest, "request_type" | "requested_count" | "details">) {
  if (request.requested_count && request.requested_count >= 1) return request.requested_count;
  if (request.request_type !== "add_nodes" && request.request_type !== "add_unit") return null;
  const match = request.details.match(/add\s+(\d{1,2})\s+(?:monitoring\s+)?(?:nodes?|units?)/i);
  return match ? Number(match[1]) : null;
}

export const REQUEST_TYPE_LABELS: Record<ServiceRequestType, string> = {
  site_installation: "Site installation",
  add_unit: "Add unit",
  add_nodes: "Add nodes",
  repair: "Repair",
};

export const REQUEST_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  open: "Open",
  completed: "Completed",
  spam: "Spam",
};

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  not_invited: "Not invited",
  invited: "Invited",
  activated: "Activated",
};

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  setup_pending: "Setup pending",
  active: "Active",
  archived: "Archived",
};

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  unassigned: "Unassigned",
  assigned: "Assigned",
  archived: "Archived",
};

export const NODE_CONNECTION_LABELS: Record<NodeConnectionState, string> = {
  cloud_online: "Cloud online",
  local_reporting: "Local reporting",
  offline: "Offline",
  unknown: "Unknown",
};
