import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

export interface CustomerProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  company: string | null;
  site_id: string;
}

export interface CustomerSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface SensorSummary {
  id: string;
  label: string;
}

export interface NodeSummary {
  id: string;
  position_in_pipe: number;
  sensors: SensorSummary[];
}

export interface UnitSummary {
  id: string;
  site_id: string;
  name: string;
  deployment_status: string;
  alert_threshold_deg: number;
  sensor_nodes: NodeSummary[];
}

export interface Reading {
  sensor_id: string;
  ts: string;
  tilt: number;
  g_mag: number;
  temp_c: number;
  alert_flag: boolean;
}

export interface CustomerAlert {
  id: string;
  ts: string;
  sensor_id: string;
  kind: string;
  severity: string;
  value: number | null;
  acknowledged_at: string | null;
  sensors?: {
    label: string;
    sensor_nodes?: { position_in_pipe: number; pipes?: { name: string } | null } | null;
  } | null;
}

export interface CustomerRequest {
  id: string;
  created_at: string;
  request_type: string;
  status: string;
  service_status: string;
  location_notes: string | null;
}

@Injectable({ providedIn: 'root' })
export class CustomerApi {
  constructor(private readonly auth: AuthService) {}

  async profile(): Promise<CustomerProfile> {
    const id = this.auth.session()?.user.id;
    if (!id) throw new Error('Sign in to continue.');
    const rows = await this.request<CustomerProfile[]>(`/rest/v1/profiles?select=id,email,full_name,phone,company,site_id&id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!rows[0]?.site_id) throw new Error('Your site access is not configured. Contact ExcaVision.');
    return rows[0];
  }

  async site(siteId: string): Promise<CustomerSite> {
    const rows = await this.request<CustomerSite[]>(`/rest/v1/sites?select=id,name,lat,lon&id=eq.${encodeURIComponent(siteId)}&limit=1`);
    if (!rows[0]) throw new Error('Your monitoring site is unavailable.');
    return rows[0];
  }

  async units(siteId: string): Promise<UnitSummary[]> {
    return this.request<UnitSummary[]>(`/rest/v1/pipes?select=id,site_id,name,deployment_status,alert_threshold_deg,sensor_nodes(id,position_in_pipe,sensors(id,label))&site_id=eq.${encodeURIComponent(siteId)}&cancelled_at=is.null&order=created_at.asc`);
  }

  async updateUnitThreshold(unitId: string, thresholdDeg: number): Promise<void> {
    await this.request('/rest/v1/rpc/update_my_monitoring_unit_threshold', {
      method: 'POST',
      body: { p_pipe_id: unitId, p_threshold_deg: thresholdDeg },
    });
  }

  async recentReadings(sensorIds: string[]): Promise<Reading[]> {
    if (!sensorIds.length) return [];
    const ids = sensorIds.map((id) => `"${id}"`).join(',');
    return this.request<Reading[]>(`/rest/v1/readings?select=sensor_id,ts,tilt,g_mag,temp_c,alert_flag&sensor_id=in.(${encodeURIComponent(ids)})&order=ts.desc&limit=500`);
  }

  async alerts(): Promise<CustomerAlert[]> {
    return this.request<CustomerAlert[]>('/rest/v1/alerts?select=id,ts,sensor_id,kind,severity,value,acknowledged_at,sensors(label,sensor_nodes(position_in_pipe,pipes(name)))&order=ts.desc&limit=100');
  }

  async requests(): Promise<CustomerRequest[]> {
    return this.request<CustomerRequest[]>('/rest/v1/service_requests?select=id,created_at,request_type,status,service_status,location_notes&order=created_at.desc&limit=50');
  }

  async createServiceRequest(requestType: 'Request repair' | 'Request more sensors', details: string): Promise<string> {
    return this.request<string>('/rest/v1/rpc/create_my_service_request', {
      method: 'POST',
      body: { p_request_type: requestType, p_location_notes: details },
    });
  }

  async acknowledgeAlert(alertId: string): Promise<void> {
    await this.request('/rest/v1/rpc/acknowledge_my_alert', {
      method: 'POST',
      body: { p_alert_id: alertId },
    });
  }

  async subscribe(onChange: () => void): Promise<() => void> {
    const { RealtimeClient } = await import('@supabase/realtime-js');
    const config = this.auth.publicConfig();
    const client = new RealtimeClient(`${config.url.replace(/^http/, 'ws')}/realtime/v1`, {
      params: { apikey: config.key },
      accessToken: () => this.auth.accessToken(),
    });
    const channel = client
      .channel('customer-monitoring')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'readings' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pipes' }, onChange)
      .subscribe();
    return () => {
      void client.removeChannel(channel);
      client.disconnect();
    };
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const config = this.auth.publicConfig();
    const token = await this.auth.accessToken();
    const response = await fetch(`${config.url}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await this.readBody(response);
    if (!response.ok) {
      const errorBody = body && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {};
      throw new Error(String(errorBody['message'] || errorBody['hint'] || errorBody['details'] || 'Customer request failed.'));
    }
    return body as T;
  }

  private async readBody(response: Response): Promise<Record<string, unknown> | unknown[] | string | null> {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
}
