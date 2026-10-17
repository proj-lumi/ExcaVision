// WBS 5.0 — Generate Events
import { sendAlertPush } from "../_shared/push.ts";

const MODEL_VERSION = "isolation-forest-v7";
const TRAINING_POINTS = 64;
const MIN_TRAINING_POINTS = 32;
const TREE_COUNT = 64;
const SAMPLE_SIZE = 32;
const DEFAULT_SCORE_THRESHOLD = 0.7;
// Score recent readings so brief spikes are not skipped.
const MAX_CANDIDATES = 8;
// Movement floor filters noise independently of the critical threshold.
const DEFAULT_MIN_MOVEMENT_DEG = 0.5;
const DEFAULT_MIN_MOVEMENT_RATIO = 0.2;

type Reading = {
  tilt_deg: number;
  gravity_magnitude_g: number | null;
  recorded_at: string;
};

type DetectorSensor = {
  id: string;
  threshold_deg: number;
};

type Point = { features: number[]; tilt_deg: number; recorded_at: string };
type Tree =
  | { size: number }
  | { feature: number; split: number; left: Tree; right: Tree };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (const character of seedText) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function harmonic(number: number) {
  if (number <= 1) return 0;
  let result = 0;
  for (let index = 1; index <= number; index += 1) result += 1 / index;
  return result;
}

function averagePathLength(size: number) {
  if (size <= 1) return 0;
  if (size === 2) return 1;
  return 2 * harmonic(size - 1) - (2 * (size - 1)) / size;
}

function buildTree(points: Point[], depth: number, maxDepth: number, random: () => number): Tree {
  if (depth >= maxDepth || points.length <= 1) return { size: points.length };
  const dimensions = points[0].features.length;
  const feature = Math.floor(random() * dimensions);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minimum = Math.min(minimum, point.features[feature]);
    maximum = Math.max(maximum, point.features[feature]);
  }
  if (minimum === maximum) return { size: points.length };

  const split = minimum + random() * (maximum - minimum);
  const left = points.filter((point) => point.features[feature] < split);
  const right = points.filter((point) => point.features[feature] >= split);
  if (!left.length || !right.length) return { size: points.length };
  return {
    feature,
    split,
    left: buildTree(left, depth + 1, maxDepth, random),
    right: buildTree(right, depth + 1, maxDepth, random),
  };
}

function pathLength(tree: Tree, features: number[], depth = 0): number {
  if ("size" in tree) return depth + averagePathLength(tree.size);
  return pathLength(
    features[tree.feature] < tree.split ? tree.left : tree.right,
    features,
    depth + 1,
  );
}

function isolationScore(training: Point[], candidate: Point, seed: string) {
  const sampleSize = Math.min(SAMPLE_SIZE, training.length);
  const maxDepth = Math.ceil(Math.log2(sampleSize));
  const random = seededRandom(seed);
  const paths: number[] = [];
  for (let index = 0; index < TREE_COUNT; index += 1) {
    const shuffled = [...training];
    for (let cursor = shuffled.length - 1; cursor > 0; cursor -= 1) {
      const swap = Math.floor(random() * (cursor + 1));
      [shuffled[cursor], shuffled[swap]] = [shuffled[swap], shuffled[cursor]];
    }
    const tree = buildTree(shuffled.slice(0, sampleSize), 0, maxDepth, random);
    paths.push(pathLength(tree, candidate.features));
  }
  const meanPath = paths.reduce((sum, value) => sum + value, 0) / paths.length;
  return Math.max(0, Math.min(1, 2 ** (-meanPath / averagePathLength(sampleSize))));
}

// Use the full training range to avoid treating ordinary jitter as movement.
function isOutsideTrainingEnvelope(training: Point[], candidate: Point) {
  return candidate.features.some((value, feature) => {
    const values = training.map((point) => point.features[feature]);
    return value < Math.min(...values) || value > Math.max(...values);
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function serviceHeaders() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function supabaseJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function logRun(sensorId: string | null, candidate: string | null, trainingPoints: number, score: number | null, status: string, errorMessage?: string) {
  try {
    await supabaseJson("/rest/v1/anomaly_analysis_runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        sensor_id: sensorId,
        candidate_recorded_at: candidate,
        model_version: MODEL_VERSION,
        training_points: trainingPoints,
        anomaly_score: score,
        status,
        error_message: errorMessage ?? null,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message.endsWith(": 409")) return;
    throw error;
  }
}

// Scores one candidate reading against the readings that precede it.
async function scoreCandidate(sensor: DetectorSensor, readings: Reading[], index: number) {
  const candidateReading = readings[index];
  const training = readings.slice(index + 1, index + 1 + TRAINING_POINTS).map((reading) => ({
    features: [reading.tilt_deg, reading.gravity_magnitude_g ?? 1],
    tilt_deg: reading.tilt_deg,
    recorded_at: reading.recorded_at,
  }));
  if (training.length < MIN_TRAINING_POINTS) return "skipped";

  const candidate: Point = {
    features: [candidateReading.tilt_deg, candidateReading.gravity_magnitude_g ?? 1],
    tilt_deg: candidateReading.tilt_deg,
    recorded_at: candidateReading.recorded_at,
  };

  // Compare against the recent median, not the commissioned zero.
  const baseline = median(training.map((point) => point.tilt_deg));
  const deviation = Math.abs(candidate.tilt_deg - baseline);
  const floor = Math.max(
    Number(Deno.env.get("ANOMALY_MIN_MOVEMENT_DEG") ?? DEFAULT_MIN_MOVEMENT_DEG),
    sensor.threshold_deg * Number(Deno.env.get("ANOMALY_MIN_MOVEMENT_RATIO") ?? DEFAULT_MIN_MOVEMENT_RATIO),
  );
  if (deviation < floor) {
    await logRun(sensor.id, candidate.recorded_at, training.length, null, "normal");
    return "normal";
  }

  const rawScore = isolationScore(training, candidate, `${sensor.id}:${candidate.recorded_at}`);
  const threshold = Number(Deno.env.get("ANOMALY_SCORE_THRESHOLD") ?? DEFAULT_SCORE_THRESHOLD);
  // A candidate outside every learned feature range is anomalous even when a
  // bounded random tree sends it to a deep leaf. Preserve the Isolation Forest
  // score, but calibrate this edge case above the configured alert threshold.
  const score = isOutsideTrainingEnvelope(training, candidate)
    ? Math.max(rawScore, Math.min(1, threshold + 0.05))
    : rawScore;
  if (score < threshold) {
    await logRun(sensor.id, candidate.recorded_at, training.length, score, "normal");
    return "normal";
  }

  // Keep one open warning per sensor.
  const openEvents = await supabaseJson(
    `/rest/v1/anomaly_events?select=id&sensor_id=eq.${sensor.id}&acknowledged_at=is.null&limit=1`,
  ) as { id: string }[];
  if (openEvents.length) {
    await logRun(sensor.id, candidate.recorded_at, training.length, score, "detected");
    return "detected";
  }

  const eventId = await supabaseJson("/rest/v1/rpc/record_isolation_forest_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_sensor_id: sensor.id,
      target_window_started_at: candidate.recorded_at,
      target_observed_value_deg: candidate.tilt_deg,
      target_baseline_value_deg: baseline,
      target_anomaly_score: score,
      target_anomalous_readings: 1,
      target_window_size: training.length,
      target_model_version: MODEL_VERSION,
    }),
  }) as string;
  try {
    await sendAlertPush("anomaly", eventId);
  } catch (error) {
    console.error("[detect-anomalies] anomaly push failed", eventId, error);
  }
  await logRun(sensor.id, candidate.recorded_at, training.length, score, "detected");
  return "detected";
}

async function analyzeSensor(sensor: DetectorSensor) {
  const readings = await supabaseJson(
    `/rest/v1/sensor_readings?select=tilt_deg,gravity_magnitude_g,recorded_at&sensor_id=eq.${sensor.id}&order=recorded_at.desc&limit=${TRAINING_POINTS + MAX_CANDIDATES}`,
  ) as Reading[];
  if (readings.length < MIN_TRAINING_POINTS + 1) {
    await logRun(sensor.id, readings[0]?.recorded_at ?? null, Math.max(0, readings.length - 1), null, "skipped");
    return "skipped";
  }

  // Every reading that arrived since the last run is a candidate, oldest first,
  // so a spike that lasted only a few seconds is still scored.
  const lastCandidate = Math.min(MAX_CANDIDATES, readings.length - MIN_TRAINING_POINTS - 1);
  const oldestCandidate = readings[lastCandidate - 1].recorded_at;
  const previousRuns = await supabaseJson(
    `/rest/v1/anomaly_analysis_runs?select=candidate_recorded_at,status&sensor_id=eq.${sensor.id}&model_version=eq.${MODEL_VERSION}&candidate_recorded_at=gte.${encodeURIComponent(oldestCandidate)}`,
  ) as { candidate_recorded_at: string; status: string }[];
  const alreadyAnalyzed = new Map(previousRuns.map((row) => [row.candidate_recorded_at, row.status]));

  let summary: "detected" | "normal" | "skipped" = "skipped";
  const scoredWindows = new Set<string>();
  // A sensor with an unacknowledged warning is already showing one; scoring
  // further windows for it would only duplicate that alert.
  const openWarning = await supabaseJson(
    `/rest/v1/anomaly_events?select=id&sensor_id=eq.${sensor.id}&acknowledged_at=is.null&limit=1`,
  ) as { id: string }[];
  const sensorMuted = openWarning.length > 0;
  for (let index = lastCandidate - 1; index >= 0; index -= 1) {
    const candidateRecordedAt = readings[index].recorded_at;
    // A batch can land several readings on one timestamp; score that window once.
    if (scoredWindows.has(candidateRecordedAt)) continue;
    scoredWindows.add(candidateRecordedAt);
    const priorStatus = alreadyAnalyzed.get(candidateRecordedAt);
    if (priorStatus && priorStatus !== "failed") continue;
    if (sensorMuted) {
      // Still analysed, but it cannot raise a second alert while one is open.
      await logRun(sensor.id, candidateRecordedAt, 0, null, "normal");
      continue;
    }
    const status = await scoreCandidate(sensor, readings, index);
    if (status === "detected") summary = "detected";
    else if (status === "normal" && summary !== "detected") summary = "normal";
  }
  return summary;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "POST required" });
  const expectedKey = Deno.env.get("ANOMALY_JOB_KEY") ?? "";
  const receivedKey = request.headers.get("x-anomaly-job-key") ?? "";
  if (!expectedKey || receivedKey !== expectedKey) return json(401, { error: "Unauthorized" });

  try {
    const assignedNodes = await supabaseJson(
      "/rest/v1/nodes?select=id,unit_id&status=eq.assigned&limit=500",
    ) as { id: string; unit_id: string | null }[];
    const failureMessages = new Set<string>();
    const summary = { analyzed: 0, detected: 0, normal: 0, skipped: 0, failed: 0, errors: [] as string[] };
    if (!assignedNodes.length) return json(200, summary);
    const unitIds = [...new Set(assignedNodes.map((node) => node.unit_id).filter((id): id is string => Boolean(id)))];
    const units = unitIds.length
      ? await supabaseJson(`/rest/v1/units?select=id,alert_threshold_deg&id=in.(${unitIds.join(",")})&limit=500`) as { id: string; alert_threshold_deg: number }[]
      : [];
    const thresholdsByUnit = new Map(units.map((unit) => [unit.id, Number(unit.alert_threshold_deg)]));
    const thresholdByNode = new Map(assignedNodes.map((node) => [node.id, thresholdsByUnit.get(node.unit_id ?? "") ?? Number.POSITIVE_INFINITY]));
    const sensors: DetectorSensor[] = [];
    for (let offset = 0; offset < assignedNodes.length; offset += 50) {
      const nodeIds = assignedNodes.slice(offset, offset + 50).map((node) => node.id).join(",");
      const batch = await supabaseJson(
        `/rest/v1/sensors?select=id,node_id&node_id=in.(${nodeIds})&limit=500`,
      ) as { id: string; node_id: string }[];
      sensors.push(...batch.map((sensor) => ({
        id: sensor.id,
        threshold_deg: thresholdByNode.get(sensor.node_id) ?? Number.POSITIVE_INFINITY,
      })));
    }

    for (let offset = 0; offset < sensors.length; offset += 4) {
      const batch = sensors.slice(offset, offset + 4);
      const results = await Promise.all(batch.map(async (sensor) => {
        try {
          return await analyzeSensor(sensor);
        } catch (error) {
          const message = error instanceof Error ? error.message : "sensor analysis failed";
          failureMessages.add(message);
          console.error("[detect-anomalies] sensor analysis failed", sensor.id, error);
          try { await logRun(sensor.id, null, 0, null, "failed", message); } catch { /* preserve the original failure */ }
          return "failed";
        }
      }));
      for (const result of results) {
        summary.analyzed += 1;
        if (result === "detected") summary.detected += 1;
        if (result === "normal") summary.normal += 1;
        if (result === "skipped") summary.skipped += 1;
        if (result === "failed") summary.failed += 1;
      }
    }
    summary.errors = [...failureMessages].slice(0, 5);
    return json(200, summary);
  } catch (error) {
    console.error("[detect-anomalies] job failed", error);
    return json(500, { error: "Anomaly analysis failed" });
  }
});
