-- Keep covering indexes for anomaly_events foreign keys. The Performance
-- Advisor's unused-index signal is not a reason to remove indexes that protect
-- parent updates/deletes and support unit/node-scoped event reads.
create index if not exists anomaly_events_unit_detected_idx
  on public.anomaly_events (unit_id, detected_at desc);

create index if not exists anomaly_events_node_id_idx
  on public.anomaly_events (node_id);
