import { sendAlertPush, sendCriticalAlertEmail } from "../_shared/push.ts";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const macPattern = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function normalizedMac(value: unknown) {
  const mac = String(value ?? "").trim().toUpperCase();
  return macPattern.test(mac) ? mac : null;
}

function finiteNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

async function rpc(name: string, body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    const details = await result.text();
    console.error(`[node-telemetry] ${name} failed`, result.status, details);
    throw new Error(name);
  }

  const text = await result.text();
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const action = url.pathname.split("/").filter(Boolean).at(-1);

  try {
    const gatewayMac = normalizedMac(request.headers.get("x-node-mac"));
    if (!gatewayMac) return response(401, { error: "Invalid Gateway MAC" });
    const gatewayId = await rpc("authenticate_gateway_by_mac", { target_mac: gatewayMac }) as string | null;
    if (!gatewayId) return response(404, { error: "Gateway is not registered as Node 1" });

    if (request.method === "POST" && action === "readings") {
      const payload = await request.json() as { readings?: Record<string, unknown>[] };
      if (!Array.isArray(payload.readings) || payload.readings.length < 1 || payload.readings.length > 50) {
        return response(422, { error: "One to fifty readings are required" });
      }

      const readings = payload.readings.map((item) => {
        const mac_address = normalizedMac(item.mac_address);
        const hardware_channel = finiteNumber(item.hardware_channel, 0, 7);
        const tilt_deg = finiteNumber(item.tilt_deg, -180, 180);
        const gravity_magnitude_g = finiteNumber(item.gravity_magnitude_g, 0, 16);
        const temperature_c = finiteNumber(item.temperature_c, -50, 125);
        const sample_count = finiteNumber(item.sample_count, 0, 100000);
        const failure_count = finiteNumber(item.failure_count, 0, 100000);
        if (
          !mac_address
          || hardware_channel === null
          || tilt_deg === null
          || gravity_magnitude_g === null
          || temperature_c === null
          || sample_count === null
          || failure_count === null
        ) {
          throw new TypeError("Invalid reading");
        }
        return {
          mac_address,
          hardware_channel,
          tilt_deg,
          gravity_magnitude_g,
          temperature_c,
          sample_count: Math.trunc(sample_count),
          failure_count: Math.trunc(failure_count),
          alert_flag: item.alert_flag === true,
        };
      });

      const inserted = await rpc("ingest_node_readings", {
        target_gateway_id: gatewayId,
        target_readings: readings,
      }) as number;
      return response(202, { accepted: inserted, rejected: readings.length - inserted });
    }

    if (request.method === "POST" && action === "alert") {
      const payload = await request.json() as Record<string, unknown>;
      const mac_address = normalizedMac(payload.mac_address);
      const hardware_channel = finiteNumber(payload.hardware_channel, 0, 7);
      const observed_value_deg = finiteNumber(payload.observed_value_deg, -180, 180);
      if (!mac_address || hardware_channel === null || observed_value_deg === null) {
        return response(422, { error: "Invalid alert" });
      }
      const event_id = await rpc("record_node_threshold_event", {
        target_gateway_id: gatewayId,
        target_mac: mac_address,
        target_channel: Math.trunc(hardware_channel),
        target_observed_value_deg: observed_value_deg,
      }) as string | null;
      if (!event_id) return response(202, { accepted: true, duplicate: true });
      try {
        await sendAlertPush("threshold", event_id);
      } catch (error) {
        console.error("[node-telemetry] threshold push failed", event_id, error);
      }
      try {
        await sendCriticalAlertEmail(event_id);
      } catch (error) {
        console.error("[node-telemetry] critical alert email failed", event_id, error);
      }
      return response(202, { event_id });
    }

    if (request.method === "POST" && action === "baseline") {
      const payload = await request.json() as Record<string, unknown>;
      const mac_address = normalizedMac(payload.mac_address);
      const hardware_channel = finiteNumber(payload.hardware_channel, 0, 7);
      const baseline_x = finiteNumber(payload.baseline_x, -1.1, 1.1);
      const baseline_y = finiteNumber(payload.baseline_y, -1.1, 1.1);
      const baseline_z = finiteNumber(payload.baseline_z, -1.1, 1.1);
      if (!mac_address || hardware_channel === null || baseline_x === null || baseline_y === null || baseline_z === null) {
        return response(422, { error: "Invalid baseline" });
      }
      await rpc("upsert_sensor_baseline", {
        target_gateway_id: gatewayId,
        target_mac: mac_address,
        target_channel: Math.trunc(hardware_channel),
        target_baseline_x: baseline_x,
        target_baseline_y: baseline_y,
        target_baseline_z: baseline_z,
      });
      return response(202, { accepted: true });
    }

    if (request.method === "GET" && action === "config") {
      const mac_address = normalizedMac(url.searchParams.get("mac_address"));
      if (!mac_address) return response(422, { error: "Invalid Mac address" });
      const rows = await rpc("get_node_config", {
        target_gateway_id: gatewayId,
        target_mac: mac_address,
      }) as { threshold_deg: number }[];
      if (!rows.length) return response(404, { error: "Node is not assigned" });
      return response(200, rows[0]);
    }

    if (request.method === "GET" && action === "baselines") {
      const mac_address = normalizedMac(url.searchParams.get("mac_address"));
      if (!mac_address) return response(422, { error: "Invalid Mac address" });
      const baselines = await rpc("get_sensor_baselines", {
        target_gateway_id: gatewayId,
        target_mac: mac_address,
      });
      return response(200, baselines);
    }

    return response(404, { error: "Telemetry action not found" });
  } catch (error) {
    if (error instanceof TypeError) return response(422, { error: error.message });
    return response(500, { error: "Telemetry could not be processed" });
  }
});
