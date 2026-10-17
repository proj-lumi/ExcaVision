import type { AnomalyEvent, CustomerUnit, HealthStatus, MonitoringNode, NodeHealth, ReadingStatus, SensorSnapshot, TiltStatus } from "~/types/mock";

export type StatusColor = "neutral" | "primary" | "success" | "warning" | "error";

export function nodeRole(node: MonitoringNode) {
  return node.position === 1 ? "Gateway" : "Sensor node";
}

export function nodeDisplayName(node: MonitoringNode) {
  return node.position ? `Node ${node.position}` : "Unassigned node";
}

export function sensorCount(node: MonitoringNode) {
  return node.sensors.length;
}

export function reportingSensorCount(node: MonitoringNode) {
  return node.sensors.filter((sensor) => sensor.reading_status === "reporting" && sensor.current_value_deg !== null).length;
}

function hasMissingSensorReadings(node: MonitoringNode) {
  // The API includes every configured sensor, including sensors that have not
  // produced a recent reading. A node is only healthy when all of its
  // configured sensors are currently reporting.
  const configuredSensors = sensorCount(node);
  return configuredSensors > 0 && reportingSensorCount(node) < configuredSensors;
}

export function nodeHealth(node: MonitoringNode, gateway?: MonitoringNode): NodeHealth {
  if (nodeRole(node) === "Gateway") {
    if (node.connection_state === "offline") return "Gateway offline";
    if (node.connection_state === "unknown") return "Gateway status unavailable";
  } else {
    // A slave never talks to Supabase directly. If the Gateway is unavailable,
    // the cloud cannot distinguish a healthy slave from an unreachable one.
    if (!gateway || gateway.connection_state !== "cloud_online") return "Local status unavailable";
    if (node.connection_state === "offline") return "Local node offline";
    if (node.connection_state === "unknown") return "Local status unavailable";
  }
  if (hasMissingSensorReadings(node)) return "Sensor readings missing";
  return "Healthy";
}

export function gatewayNode(unit: CustomerUnit) {
  return unit.nodes.find((node) => node.position === 1);
}

export function unitHealth(unit: CustomerUnit): NodeHealth {
  const gateway = gatewayNode(unit);
  if (!gateway) return "Gateway status unavailable";
  if (gateway.connection_state === "offline") return "Gateway offline";
  if (gateway.connection_state === "unknown") return "Gateway status unavailable";
  if (unit.nodes.some((node) => node.position !== 1 && node.connection_state === "offline")) return "Local node offline";
  if (unit.nodes.some((node) => node.position !== 1 && node.connection_state === "unknown")) return "Local status unavailable";
  if (unit.nodes.some(hasMissingSensorReadings)) return "Sensor readings missing";
  return "Healthy";
}

export function healthStatus(status: NodeHealth): HealthStatus {
  return status === "Healthy" ? "Healthy" : "Attention";
}
export function nodeHealthStatus(node: MonitoringNode, gateway?: MonitoringNode): HealthStatus { return healthStatus(nodeHealth(node, gateway)); }
export function unitHealthStatus(unit: CustomerUnit): HealthStatus { return healthStatus(unitHealth(unit)); }

export function readingStatus(status: TiltStatus): ReadingStatus {
  if (status === "Threshold exceeded") return "Critical";
  if (status === "Data unavailable") return "No data";
  return "Normal";
}
export function hasActiveAnomaly(unit: CustomerUnit, anomalyEvents: AnomalyEvent[] = []) {
  // The detector applies the movement floor; the UI only needs to know whether
  // an anomaly for this unit is still unacknowledged.
  return anomalyEvents.some((event) => event.unit_id === unit.id && event.acknowledged_at === null);
}

export function unitReadingStatus(unit: CustomerUnit, anomalyEvents: AnomalyEvent[] = []): ReadingStatus {
  const thresholdStatus = readingStatus(tiltStatus(unit));
  if (thresholdStatus === "Critical") return thresholdStatus;
  return hasActiveAnomaly(unit, anomalyEvents) ? "Warning" : thresholdStatus;
}

export function unitAttentionScore(unit: CustomerUnit) {
  const readingScore: Record<ReadingStatus, number> = { Critical: 40, Warning: 30, "No data": 20, Normal: 0 };
  return readingScore[unitReadingStatus(unit)] + (unitHealthStatus(unit) === "Attention" ? 5 : 0);
}
export function compareUnitAttention(a: CustomerUnit, b: CustomerUnit) { return unitAttentionScore(b) - unitAttentionScore(a) || a.name.localeCompare(b.name); }

/**
 * Readings are plotted on a real time axis, so a window can span days. Clock
 * time alone would make an alert from last week look like it just happened.
 */
export function formatPhilippineDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

export function formatPhilippineDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Axis tick label: adds the date once a window is longer than a day. */
export function formatAxisTime(value: number, spanMs: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const withDate = spanMs > 24 * 60 * 60 * 1000;
  const withSeconds = spanMs <= 60 * 1000;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    ...(withDate ? { day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  }).format(date);
}

export function formatPhilippineTime(value: string) {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  }
  return value;
}

export function formatRelativeTime(value: string | null) {
  if (!value) return "Unavailable";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function healthIcon(status: HealthStatus) { return status === "Healthy" ? "i-lucide-heart-pulse" : "i-lucide-heart-crack"; }
export function readingIcon(status: ReadingStatus) {
  if (status === "Critical") return "i-lucide-octagon-alert";
  if (status === "Warning") return "i-lucide-triangle-alert";
  if (status === "No data") return "i-lucide-database-zap";
  return "i-lucide-gauge";
}
export function readingTextClass(status: ReadingStatus) {
  if (status === "Critical") return "text-error";
  if (status === "Warning") return "text-warning";
  if (status === "No data") return "text-muted";
  return "text-success";
}
export function statusIcon(status: string) {
  if (status === "Received") return "i-lucide-inbox";
  if (status === "Under review") return "i-lucide-eye";
  if (status === "Scheduled") return "i-lucide-calendar-clock";
  if (status === "Complete" || status === "Seen") return "i-lucide-circle-check";
  if (status === "Needs review") return "i-lucide-scan-search";
  return "i-lucide-circle-help";
}

export function peakSensor(unit: CustomerUnit) {
  const gateway = gatewayNode(unit);
  const liveReadings = gateway?.connection_state === "cloud_online"
    ? unit.nodes.flatMap((node) => node.sensors
      .filter((sensor): sensor is SensorSnapshot & { current_value_deg: number } => sensor.reading_status === "reporting" && sensor.current_value_deg !== null)
      .map((sensor) => ({ node, sensor, value: Math.abs(sensor.current_value_deg) })))
    : [];
  return liveReadings.reduce<typeof liveReadings[number] | undefined>((peak, reading) => !peak || reading.value > peak.value ? reading : peak, undefined);
}
export function peakTilt(unit: CustomerUnit) { return peakSensor(unit)?.value ?? unit.trend.at(-1)?.value_deg ?? null; }
export function tiltStatus(unit: CustomerUnit): TiltStatus {
  const gateway = gatewayNode(unit);
  const value = peakSensor(unit)?.value ?? null;
  if (!gateway || gateway.connection_state !== "cloud_online" || value === null) return "Data unavailable";
  if (value >= unit.alert_threshold_deg) return "Threshold exceeded";
  return "Nominal";
}

export function statusColor(status: string): StatusColor {
  if (["Normal", "Healthy", "Complete"].includes(status)) return "success";
  if (["Critical", "Threshold exceeded"].includes(status)) return "error";
  if (["Warning", "Attention", "Under review", "Scheduled"].includes(status)) return "warning";
  if (["No data", "Received", "Seen"].includes(status)) return "neutral";
  return "primary";
}
export function sensorValue(sensor: SensorSnapshot) { return sensor.current_value_deg === null ? "—" : `${sensor.current_value_deg.toFixed(2)}°`; }
