import type { CustomerMockData } from "~/types/mock";
import { combinedAdvisories, type AdvisoryItem } from "~/utils/advisories";
import { nodeDisplayName } from "~/utils/presentation";

export type AlertItem = AdvisoryItem | {
  id: string;
  kind: "critical";
  location: string;
  observed_value_deg: number;
  threshold_deg: number;
  detected_at: string;
  acknowledged: boolean;
  unit_id: string;
  node_id: string;
  sensor_id: string;
};

export function combinedAlerts(data: CustomerMockData | null): AlertItem[] {
  if (!data) return [];
  const criticalAlerts: AlertItem[] = data.threshold_events.map((event) => {
    const unit = data.units.find((item) => item.id === event.unit_id);
    const node = unit?.nodes.find((item) => item.sensors.some((sensor) => sensor.id === event.sensor_id));
    const sensor = node?.sensors.find((item) => item.id === event.sensor_id);
    return {
      id: event.id,
      kind: "critical",
      location: `${unit?.name ?? event.unit_id} · ${node ? nodeDisplayName(node) : "Node"} · Sensor ${sensor?.position ?? "?"}`,
      observed_value_deg: event.observed_value_deg,
      threshold_deg: event.threshold_deg,
      detected_at: event.detected_at,
      acknowledged: event.acknowledged_at !== null,
      unit_id: event.unit_id,
      node_id: node?.id ?? "",
      sensor_id: event.sensor_id,
    };
  });
  return [...combinedAdvisories(data), ...criticalAlerts];
}

export function alertStatus(alert: AlertItem): "Warning" | "Critical" {
  return alert.kind === "critical" ? "Critical" : "Warning";
}

export function anomalyScorePercent(alert: AlertItem) {
  if (alert.kind !== "anomaly") return "";
  return `${Math.round(Math.max(0, Math.min(1, alert.anomaly_score)) * 100)}%`;
}

export function alertSummary(alert: AlertItem) {
  if (alert.kind === "anomaly") {
    // Lead with the movement, because that is the only number an operator can
    // act on. The detector name and the window statistics are not useful here.
    const movement = Math.abs(alert.observed_value_deg - alert.baseline_value_deg);
    return `Moved ${movement.toFixed(2)}° from its normal position - now ${alert.observed_value_deg.toFixed(2)}°, normally ${alert.baseline_value_deg.toFixed(2)}°.`;
  }
  const over = Math.abs(alert.observed_value_deg) - alert.threshold_deg;
  return `Tilt reached ${alert.observed_value_deg.toFixed(2)}°, over the ${alert.threshold_deg.toFixed(2)}° threshold by ${over.toFixed(2)}°.`;
}
