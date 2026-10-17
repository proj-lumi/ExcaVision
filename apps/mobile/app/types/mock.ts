export * from "../../../../packages/domain/types";

import type {
  AnomalyEvent,
  Node,
  Profile,
  Sensor,
  Site,
  ThresholdEvent,
  Unit,
} from "../../../../packages/domain/types";

export type LoadStatus = "idle" | "pending" | "success" | "error";
export type NodeRole = "Gateway" | "Sensor node";
export type NodeHealth = "Healthy" | "Gateway offline" | "Gateway status unavailable" | "Local node offline" | "Sensor readings missing" | "Local status unavailable";
export type TiltStatus = "Nominal" | "Threshold exceeded" | "Data unavailable";
export type HealthStatus = "Healthy" | "Attention";
export type ReadingStatus = "Normal" | "Warning" | "Critical" | "No data";
export type CoverageKind = "add_nodes" | "add_unit";

export interface TrendPoint {
  recorded_at: string;
  value_deg: number;
}

export type SensorReadingStatus = "reporting" | "missing" | "unknown";
export interface SensorSnapshot extends Sensor {
  reading_status: SensorReadingStatus;
  current_value_deg: number | null;
  last_recorded_at: string | null;
  latest_sample_count: number;
  latest_failure_count: number;
  history: TrendPoint[];
}

export interface MonitoringNode extends Node {
  sensors: SensorSnapshot[];
}

export interface CustomerUnit extends Unit {
  trend: TrendPoint[];
  nodes: MonitoringNode[];
}

export interface CustomerMockData {
  profile: Profile;
  site: Site;
  units: CustomerUnit[];
  threshold_events: ThresholdEvent[];
  anomaly_events: AnomalyEvent[];
}

export interface CustomerStoreState {
  status: LoadStatus;
  data: CustomerMockData | null;
  error: string | null;
}

export interface AccessibilityPreferences {
  large_telemetry: boolean;
  reduce_motion: boolean;
}
