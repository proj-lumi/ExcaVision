import type { AnomalyEvent, CustomerMockData } from "~/types/mock";
import { nodeDisplayName } from "~/utils/presentation";

export interface AdvisoryItem {
  id: string;
  kind: "anomaly";
  location: string;
  observed_value_deg: number;
  baseline_value_deg: number;
  anomaly_score: number;
  anomalous_readings: number;
  window_size: number;
  detected_at: string;
  acknowledged: boolean;
  unit_id: string;
  node_id: string;
  sensor_id: string;
}

function anomalyLocation(data: CustomerMockData, event: AnomalyEvent) {
  const unit = data.units.find((item) => item.id === event.unit_id);
  const node = unit?.nodes.find((item) => item.id === event.node_id);
  const sensor = node?.sensors.find((item) => item.id === event.sensor_id);
  return `${unit?.name ?? event.unit_id} · ${node ? nodeDisplayName(node) : event.node_id} · Sensor ${sensor?.position ?? "?"}`;
}

export function combinedAdvisories(data: CustomerMockData | null): AdvisoryItem[] {
  if (!data) return [];
  // The detector owns the definition of an anomaly (score + movement floor), so
  // the UI renders every unacknowledged event instead of re-judging it here.
  return data.anomaly_events.map((event) => ({
    id: event.id,
    kind: "anomaly",
    location: anomalyLocation(data, event),
    observed_value_deg: event.observed_value_deg,
    baseline_value_deg: event.baseline_value_deg,
    anomaly_score: event.anomaly_score,
    anomalous_readings: event.anomalous_readings,
    window_size: event.window_size,
    detected_at: event.detected_at,
    acknowledged: event.acknowledged_at !== null,
    unit_id: event.unit_id,
    node_id: event.node_id,
    sensor_id: event.sensor_id,
  }));
}
