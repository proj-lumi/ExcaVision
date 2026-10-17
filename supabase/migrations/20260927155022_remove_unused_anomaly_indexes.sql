-- Remove indexes that the Performance Advisor reports as unused.
-- Keep the composite sensor indexes: they support alert history and the
-- one-open-event constraint. These standalone indexes add write overhead
-- without serving a current query path.
drop index if exists public.anomaly_events_unit_detected_idx;
drop index if exists public.anomaly_events_node_id_idx;
drop index if exists public.anomaly_events_sensor_id_idx;
