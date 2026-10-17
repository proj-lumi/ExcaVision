export * from "../../../../packages/domain/types";

import type {
  AnomalyEvent,
  Node,
  Profile,
  RequestAttachment,
  Sensor,
  ServiceRequest,
  Site,
  ThresholdEvent,
  Unit,
} from "../../../../packages/domain/types";

export interface AdminMockData {
  current_profile_id: string;
  profiles: Profile[];
  service_requests: ServiceRequest[];
  request_attachments: RequestAttachment[];
  sites: Site[];
  units: Unit[];
  nodes: Node[];
  sensors: Sensor[];
  threshold_events: ThresholdEvent[];
  anomaly_events: AnomalyEvent[];
}

export type UnitInput = Pick<Unit, "site_id" | "name"> & { source_request_id?: string | null; source_request_unit_index?: number | null };
export type InvitationInput = Pick<Profile, "full_name" | "email" | "phone" | "company_name">;
