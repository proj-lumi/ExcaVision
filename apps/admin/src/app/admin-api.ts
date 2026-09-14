import { Injectable, signal } from '@angular/core';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export interface AdminSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export interface ServiceRequestIntake {
  id: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'spam';
  review_reason: string | null;
  accepted_request_id: string | null;
  request_type: 'Request installation';
  name: string;
  company: string | null;
  email: string;
  phone: string;
  location_name: string;
  location_label: string | null;
  location_notes: string | null;
  latitude: number;
  longitude: number;
  osm_url: string;
  google_maps_url: string | null;
}

export interface ServiceRequest {
  id: string;
  created_at: string;
  request_type: string;
  name: string;
  company: string | null;
  email: string;
  phone: string;
  location_name: string;
  location_label: string | null;
  location_notes: string | null;
  latitude: number;
  longitude: number;
  osm_url: string;
  google_maps_url: string | null;
  status: string;
  assigned_staff_id: string | null;
  site_id: string | null;
  created_site_id: string | null;
  fulfillment_path: 'repair_existing_unit' | 'expand_existing_unit' | 'new_unit_existing_site' | 'multi_unit_service' | null;
  target_site_id: string | null;
  target_pipe_id: string | null;
  created_pipe_id: string | null;
  service_status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  service_completed_at: string | null;
  service_completed_by: string | null;
  closure_type: 'not_proceeding' | 'cancelled' | null;
  closure_reason: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_site_name?: string | null;
  created_pipe_name?: string | null;
  created_pipe_status?: string | null;
  target_site_name?: string | null;
  target_pipe_name?: string | null;
  needs_action?: boolean;
}

export interface ServiceRequestTarget {
  id: string;
  service_request_id: string;
  target_kind: 'existing_unit' | 'new_unit';
  operation: 'expand_nodes' | 'replace_nodes' | 'install_unit';
  site_id: string;
  pipe_id: string | null;
  requested_node_count: number;
  added_node_count: number;
  created_pipe_id: string | null;
  created_at: string;
  site_name?: string;
  pipe_name?: string | null;
  created_pipe_name?: string | null;
  created_pipe_status?: string | null;
  work_plan_confirmed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  planned_unit_name: string | null;
  plan_position: number | null;
}

export interface Site {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  created_at: string;
  monitoring_unit_count?: number;
  ready_monitoring_unit_count?: number;
  customer_email?: string | null;
}

export interface MonitoringUnit {
  id: string;
  site_id: string;
  name: string;
  installed_at: string | null;
  alert_threshold_deg: number;
  expected_node_count: number;
  deployment_status: string;
  plan_confirmed: boolean;
  commissioning_notes: string | null;
  hardware_mounted_check: boolean;
  rs485_check: boolean;
  gateway_online_check: boolean;
  readings_received_check: boolean;
  baseline_captured_check: boolean;
  commissioned_at: string | null;
  commissioned_by: string | null;
  created_at: string;
  site_name?: string;
  node_count?: number;
  gateway_count?: number;
  max_position?: number;
}

export interface ManufacturedNode {
  id: string;
  serial_number: string;
  mac_addr: string;
  batch_code: string | null;
  assigned_site_id: string | null;
  assigned_pipe_id: string | null;
  position_in_pipe: number | null;
  is_gateway: boolean;
  manufactured_at: string;
  deployed_node_id: string | null;
  status: 'manufactured' | 'deployed' | 'retired';
  notes: string | null;
  site_name?: string | null;
  pipe_name?: string | null;
}

declare global {
  interface Window {
    EXCAVISION_CONFIG?: {
      supabaseUrl?: string;
      supabasePublishableKey?: string;
    };
  }
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  readonly session = signal<AdminSession | null>(null);
  readonly configured = Boolean(
    window.EXCAVISION_CONFIG?.supabaseUrl &&
    window.EXCAVISION_CONFIG?.supabasePublishableKey,
  );

  private readonly url = window.EXCAVISION_CONFIG?.supabaseUrl?.replace(/\/$/, '') ?? '';
  private readonly key = window.EXCAVISION_CONFIG?.supabasePublishableKey ?? '';
  private readonly storageKey = 'excavision.admin.session';
  private realtimeClient: SupabaseClient | null = null;
  private realtimeClientPromise: Promise<SupabaseClient> | null = null;
  private refreshPromise: Promise<AdminSession> | null = null;

  constructor() {
    this.restoreSession();
  }

  async signIn(email: string, password: string): Promise<void> {
    this.assertConfigured();
    const response = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: this.publicHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const body = await this.readBody(response);
    if (!response.ok) throw new Error(body?.msg || body?.error_description || 'Unable to sign in.');

    const session = this.toSession(body);
    const profile = await this.request<Array<{ role: string }>>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=role`,
      { session },
    );
    if (profile[0]?.role !== 'admin') {
      throw new Error('This account does not have ExcaVision admin access.');
    }
    this.saveSession(session);
  }

  signOut(): void {
    localStorage.removeItem(this.storageKey);
    this.session.set(null);
  }

  async listRequestsPage(input: {
    search: string;
    filter: 'needs-action' | 'approved' | 'finished' | 'all';
    requestType: 'all' | 'Request installation' | 'Request repair' | 'Request more sensors';
    page: number;
    pageSize: number;
  }): Promise<PageResult<ServiceRequest>> {
    const params = new URLSearchParams({ select: '*', order: 'created_at.desc' });
    const search = this.searchTerm(input.search);
    if (search) params.set('or', `(location_name.ilike.*${search}*,name.ilike.*${search}*,company.ilike.*${search}*,email.ilike.*${search}*)`);
    if (input.filter === 'needs-action') params.set('needs_action', 'eq.true');
    if (input.filter === 'approved') params.set('status', 'eq.approved');
    if (input.filter === 'finished') params.set('service_status', 'eq.completed');
    if (input.requestType !== 'all') params.set('request_type', `eq.${input.requestType}`);
    return this.requestPage(`/rest/v1/admin_service_request_list?${params}`, input.page, input.pageSize);
  }

  async listRequestIntakesPage(input: {
    search: string;
    filter: 'pending' | 'accepted' | 'rejected' | 'spam' | 'all';
    page: number;
    pageSize: number;
  }): Promise<PageResult<ServiceRequestIntake>> {
    const params = new URLSearchParams({ select: '*', order: 'created_at.desc' });
    const search = this.searchTerm(input.search);
    if (search) params.set('or', `(location_name.ilike.*${search}*,name.ilike.*${search}*,email.ilike.*${search}*,company.ilike.*${search}*)`);
    if (input.filter !== 'all') params.set('status', `eq.${input.filter}`);
    return this.requestPage(`/rest/v1/admin_service_request_intake_list?${params}`, input.page, input.pageSize);
  }

  async acceptRequestIntake(id: string): Promise<void> {
    await this.request('/rest/v1/rpc/admin_accept_request_intake', {
      method: 'POST',
      body: { p_intake_id: id },
    });
  }

  async rejectRequestIntake(id: string, disposition: 'rejected' | 'spam', reason: string): Promise<void> {
    await this.request('/rest/v1/rpc/admin_reject_request_intake', {
      method: 'POST',
      body: { p_intake_id: id, p_disposition: disposition, p_reason: reason },
    });
  }

  async listTargetsForRequests(requestIds: string[]): Promise<ServiceRequestTarget[]> {
    if (!requestIds.length) return [];
    const ids = requestIds.map((id) => `"${id}"`).join(',');
    return this.request(`/rest/v1/admin_service_request_target_list?select=*&service_request_id=in.(${ids})&order=plan_position.asc.nullslast,created_at.asc`);
  }

  async listSitesPage(search: string, page: number, pageSize: number): Promise<PageResult<Site>> {
    const params = new URLSearchParams({ select: '*', order: 'name.asc' });
    const term = this.searchTerm(search);
    if (term) params.set('name', `ilike.*${term}*`);
    return this.requestPage(`/rest/v1/admin_site_list?${params}`, page, pageSize);
  }

  async listMonitoringUnitsPage(input: {
    search: string;
    filter: 'all' | 'planning' | 'field-work' | 'active';
    page: number;
    pageSize: number;
  }): Promise<PageResult<MonitoringUnit>> {
    const params = new URLSearchParams({ select: '*', order: 'created_at.desc' });
    const term = this.searchTerm(input.search);
    if (term) params.set('or', `(name.ilike.*${term}*,site_name.ilike.*${term}*)`);
    if (input.filter === 'planning') params.set('deployment_status', 'eq.planning');
    if (input.filter === 'field-work') params.set('deployment_status', 'in.(installation,commissioning)');
    if (input.filter === 'active') params.set('deployment_status', 'eq.ready');
    return this.requestPage(`/rest/v1/admin_monitoring_unit_list?${params}`, input.page, input.pageSize);
  }

  async listNodesPage(input: {
    search: string;
    filter: 'all' | 'available' | 'deployed' | 'retired';
    assignment: 'all' | 'assigned' | 'unassigned';
    page: number;
    pageSize: number;
  }): Promise<PageResult<ManufacturedNode>> {
    const params = new URLSearchParams({ select: '*', order: 'manufactured_at.desc' });
    const term = this.searchTerm(input.search);
    if (term) params.set('or', `(serial_number.ilike.*${term}*,mac_addr.ilike.*${term}*)`);
    if (input.filter === 'available') params.set('status', 'eq.manufactured');
    if (input.filter === 'deployed') params.set('status', 'eq.deployed');
    if (input.filter === 'retired') params.set('status', 'eq.retired');
    if (input.assignment === 'assigned') params.set('assigned_site_id', 'not.is.null');
    if (input.assignment === 'unassigned') params.set('assigned_site_id', 'is.null');
    return this.requestPage(`/rest/v1/admin_node_list?${params}`, input.page, input.pageSize);
  }

  async searchSites(search: string, limit = 8): Promise<Site[]> {
    return (await this.listSitesPage(search, 1, limit)).items;
  }

  async searchMonitoringUnits(search: string, limit = 8, siteId?: string | null): Promise<MonitoringUnit[]> {
    const params = new URLSearchParams({ select: '*', order: 'created_at.desc' });
    const term = this.searchTerm(search);
    if (term) params.set('or', `(name.ilike.*${term}*,site_name.ilike.*${term}*)`);
    if (siteId) params.set('site_id', `eq.${encodeURIComponent(siteId)}`);
    return this.requestPage<MonitoringUnit>(`/rest/v1/admin_monitoring_unit_list?${params}`, 1, limit).then((result) => result.items);
  }

  async searchAvailableNodes(search: string, limit = 8): Promise<ManufacturedNode[]> {
    return (await this.listNodesPage({ search, filter: 'available', assignment: 'unassigned', page: 1, pageSize: limit })).items
      .filter((node) => !node.assigned_site_id && !node.assigned_pipe_id && !node.deployed_node_id);
  }

  async listPendingCoverageTargetsForUnits(unitIds: string[]): Promise<ServiceRequestTarget[]> {
    if (!unitIds.length) return [];
    const ids = unitIds.map((id) => `"${id}"`).join(',');
    return this.request(`/rest/v1/admin_service_request_target_list?select=*&pipe_id=in.(${ids})&target_kind=eq.existing_unit&operation=eq.expand_nodes&work_plan_confirmed=eq.true&completed_at=is.null&order=created_at.asc`);
  }

  async listNodesForUnit(unitId: string): Promise<ManufacturedNode[]> {
    return this.request(`/rest/v1/admin_node_list?select=*&assigned_pipe_id=eq.${encodeURIComponent(unitId)}&status=eq.deployed&order=position_in_pipe.asc&limit=64`);
  }

  async subscribeToServiceRequests(
    onChange: () => void,
    onStatus: (status: 'connecting' | 'live' | 'offline') => void,
  ): Promise<() => void> {
    const client = await this.getRealtimeClient();
    const session = await this.activeSession();
    if (!session) throw new Error('Your admin session has ended. Sign in again.');

    onStatus('connecting');
    await client.realtime.setAuth(session.access_token);
    const channel: RealtimeChannel = client
      .channel('admin-service-requests')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_requests' },
        () => onChange(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_request_intakes' },
        () => onChange(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onStatus('live');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus('offline');
      });

    return () => {
      onStatus('offline');
      void client.removeChannel(channel);
    };
  }

  async updateRequestStatus(id: string, status: string): Promise<void> {
    await this.request(`/rest/v1/service_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { status, updated_at: new Date().toISOString() },
    });
  }

  async closeServiceRequest(id: string, reason: string): Promise<void> {
    await this.request('/rest/v1/rpc/admin_close_service_request', {
      method: 'POST',
      body: { p_request_id: id, p_reason: reason },
    });
  }

  async deleteServiceRequest(id: string): Promise<void> {
    await this.callDeleteRpc('admin_delete_service_request', 'p_request_id', id);
  }

  async saveInstallationUnitPlan(requestId: string, unitNames: string[]): Promise<void> {
    await this.request('/rest/v1/rpc/admin_save_installation_unit_plan', {
      method: 'POST',
      body: {
        p_request_id: requestId,
        p_units: unitNames.map((unitName) => ({ unit_name: unitName })),
      },
    });
  }

  async createSiteFromRequest(requestId: string, siteName: string): Promise<void> {
    await this.request('/rest/v1/rpc/admin_create_site_from_request', {
      method: 'POST',
      body: { p_request_id: requestId, p_site_name: siteName },
    });
  }

  async routeServiceRequest(input: {
    p_request_id: string;
    p_path: 'repair_existing_unit' | 'expand_existing_unit' | 'new_unit_existing_site';
    p_site_id?: string | null;
    p_pipe_id?: string | null;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/admin_route_service_request', {
      method: 'POST',
      body: input,
    });
  }

  async saveRepairTargets(requestId: string, targets: Array<{ pipe_id: string }>): Promise<void> {
    await this.request('/rest/v1/rpc/admin_save_repair_targets', {
      method: 'POST',
      body: { p_request_id: requestId, p_targets: targets },
    });
  }

  async saveMoreCoverageTargets(requestId: string, targets: Array<{
    target_kind: 'existing_unit' | 'new_unit';
    site_id?: string | null;
    pipe_id?: string | null;
  }>): Promise<void> {
    await this.request('/rest/v1/rpc/admin_save_more_coverage_targets', {
      method: 'POST',
      body: { p_request_id: requestId, p_targets: targets },
    });
  }

  async planServiceTarget(targetId: string, plannedNodeCount: number): Promise<void> {
    await this.request('/rest/v1/rpc/admin_plan_service_target', {
      method: 'POST',
      body: { p_target_id: targetId, p_planned_node_count: plannedNodeCount },
    });
  }

  async completeServiceTarget(targetId: string): Promise<void> {
    await this.request('/rest/v1/rpc/admin_complete_service_target', {
      method: 'POST',
      body: { p_target_id: targetId },
    });
  }

  async createMonitoringUnitFromTarget(targetId: string, unitName: string): Promise<string> {
    return this.request<string>('/rest/v1/rpc/admin_create_monitoring_unit_from_target', {
      method: 'POST',
      body: { p_target_id: targetId, p_unit_name: unitName },
    });
  }

  async addNodeToServiceTarget(input: {
    p_target_id: string;
    p_registry_id: string;
    p_position: number;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/admin_add_node_to_service_target', {
      method: 'POST',
      body: input,
    });
  }

  async replaceNodeForTarget(input: {
    p_target_id: string;
    p_sensor_node_id: string;
    p_replacement_registry_id: string;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/admin_replace_node_for_target', {
      method: 'POST',
      body: input,
    });
  }

  async createMonitoringUnitFromRequest(requestId: string, unitName: string): Promise<string> {
    return this.request<string>('/rest/v1/rpc/admin_create_monitoring_unit_from_request', {
      method: 'POST',
      body: { p_request_id: requestId, p_unit_name: unitName },
    });
  }

  async inviteCustomer(input: {
    siteId: string;
    email: string;
    fullName: string;
    phone: string;
    company?: string | null;
  }): Promise<void> {
    await this.request('/functions/v1/invite-customer', { method: 'POST', body: input });
  }

  async updateSite(id: string, name: string): Promise<void> {
    await this.request(`/rest/v1/sites?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { name },
    });
  }

  async deleteSite(id: string): Promise<void> {
    await this.callDeleteRpc('admin_delete_empty_site', 'p_site_id', id);
  }

  async createMonitoringUnit(input: {
    site_id: string;
    name: string;
    expected_node_count: number;
    alert_threshold_deg: number;
  }): Promise<void> {
    await this.request('/rest/v1/pipes', { method: 'POST', body: input });
  }

  async updateMonitoringUnitThreshold(id: string, threshold: number): Promise<void> {
    await this.request(`/rest/v1/pipes?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { alert_threshold_deg: threshold },
    });
  }

  async updateMonitoringUnit(
    id: string,
    input: { name: string; expected_node_count: number; alert_threshold_deg: number },
  ): Promise<void> {
    await this.request(`/rest/v1/pipes?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  async deleteMonitoringUnit(id: string): Promise<void> {
    await this.callDeleteRpc('admin_delete_empty_monitoring_unit', 'p_pipe_id', id);
  }

  async advanceDeployment(input: {
    p_pipe_id: string;
    p_action: 'mark_installation_ready' | 'start_commissioning' | 'save_commissioning' | 'complete_commissioning';
    p_notes?: string | null;
    p_hardware_mounted?: boolean | null;
    p_rs485?: boolean | null;
    p_gateway_online?: boolean | null;
    p_readings_received?: boolean | null;
    p_baseline_captured?: boolean | null;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/admin_advance_deployment', {
      method: 'POST',
      body: input,
    });
  }

  async addNodeToActiveUnit(input: {
    p_registry_id: string;
    p_pipe_id: string;
    p_position: number;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/admin_add_node_to_active_unit', {
      method: 'POST',
      body: input,
    });
  }

  async completeServiceRequest(requestId: string): Promise<void> {
    await this.request('/rest/v1/rpc/admin_complete_service_request', {
      method: 'POST',
      body: { p_request_id: requestId },
    });
  }

  async replaceNode(input: {
    p_pipe_id: string;
    p_sensor_node_id: string;
    p_replacement_registry_id: string;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/admin_replace_node', {
      method: 'POST',
      body: input,
    });
  }

  async registerNode(input: {
    mac_addr: string;
  }): Promise<void> {
    await this.request('/rest/v1/manufactured_nodes', { method: 'POST', body: input });
  }

  async deleteAvailableNode(id: string): Promise<void> {
    await this.callDeleteRpc('admin_delete_available_node', 'p_registry_id', id);
  }

  async saveInstallationHardwareSetup(input: {
    p_pipe_id: string;
    p_expected_node_count: number;
    p_manifest: Array<{ registry_id: string; position: number }>;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/admin_save_installation_hardware_setup', {
      method: 'POST',
      body: input,
    });
  }

  async deployNode(input: {
    p_registry_id: string;
    p_pipe_id: string;
    p_position: number;
    p_is_gateway: boolean;
  }): Promise<void> {
    await this.request('/rest/v1/rpc/admin_deploy_manufactured_node', {
      method: 'POST',
      body: input,
    });
  }

  private async getRealtimeClient(): Promise<SupabaseClient> {
    this.assertConfigured();
    if (this.realtimeClient) return this.realtimeClient;
    if (!this.realtimeClientPromise) {
      this.realtimeClientPromise = import('@supabase/supabase-js').then(({ createClient }) => {
        const client = createClient(this.url, this.key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        this.realtimeClient = client;
        return client;
      }).finally(() => { this.realtimeClientPromise = null; });
    }
    return this.realtimeClientPromise;
  }

  private async callDeleteRpc(functionName: string, parameter: string, id: string): Promise<void> {
    await this.request(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      body: { [parameter]: id },
    });
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      session?: AdminSession;
    } = {},
  ): Promise<T> {
    const response = await this.sendRequest(path, options, { Prefer: 'return=minimal' });
    const body = await this.readBody(response);
    if (!response.ok) throw new Error(body?.error || body?.message || body?.hint || body?.details || 'Admin request failed.');
    return body as T;
  }

  private async requestPage<T>(path: string, page: number, pageSize: number): Promise<PageResult<T>> {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const offset = (safePage - 1) * safeSize;
    const response = await this.sendRequest(path, {}, {
      Prefer: 'count=exact',
      Range: `${offset}-${offset + safeSize - 1}`,
    });
    const body = await this.readBody(response);
    if (!response.ok) throw new Error(body?.error || body?.message || body?.hint || body?.details || 'Admin list request failed.');
    const contentRange = response.headers.get('content-range') ?? '';
    const total = Number(contentRange.split('/')[1]);
    return { items: (Array.isArray(body) ? body : []) as T[], total: Number.isFinite(total) ? total : 0 };
  }

  private async sendRequest(
    path: string,
    options: { method?: string; body?: unknown; session?: AdminSession },
    extraHeaders: Record<string, string>,
  ): Promise<Response> {
    this.assertConfigured();
    let session = options.session ?? (await this.activeSession());
    if (!session) throw new Error('Your admin session has ended. Sign in again.');

    const send = (activeSession: AdminSession) => fetch(`${this.url}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...this.publicHeaders(),
        Authorization: `Bearer ${activeSession.access_token}`,
        ...extraHeaders,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    let response = await send(session);
    if (response.status === 401 && !options.session) {
      session = await this.refreshSession();
      response = await send(session);
    }
    if (response.status === 401) {
      this.signOut();
      throw new Error('Your admin session has ended. Sign in again.');
    }
    return response;
  }

  private searchTerm(value: string): string {
    return value.trim().replace(/[,*()%_]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
  }

  private publicHeaders(): Record<string, string> {
    return {
      apikey: this.key,
      'Content-Type': 'application/json',
    };
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new Error('Supabase runtime configuration is missing. See apps/admin/README.md.');
    }
  }

  private restoreSession(): void {
    try {
      const value = localStorage.getItem(this.storageKey);
      if (!value) return;
      const session = JSON.parse(value) as AdminSession;
      if (!session.refresh_token) {
        localStorage.removeItem(this.storageKey);
        return;
      }
      this.session.set(session);
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }

  private saveSession(session: AdminSession): void {
    localStorage.setItem(this.storageKey, JSON.stringify(session));
    this.session.set(session);
    void this.realtimeClient?.realtime.setAuth(session.access_token);
  }

  private async activeSession(): Promise<AdminSession | null> {
    const session = this.session();
    if (!session) return null;
    if (session.expires_at * 1000 > Date.now() + 60_000) return session;
    return this.refreshSession();
  }

  private async refreshSession(): Promise<AdminSession> {
    if (this.refreshPromise) return this.refreshPromise;
    const current = this.session();
    if (!current?.refresh_token) throw new Error('Your admin session has ended. Sign in again.');

    this.refreshPromise = (async () => {
      const response = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: this.publicHeaders(),
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      const body = await this.readBody(response);
      if (!response.ok) {
        this.signOut();
        throw new Error('Your admin session has ended. Sign in again.');
      }
      const session = this.toSession(body);
      this.saveSession(session);
      return session;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private toSession(body: Record<string, unknown>): AdminSession {
    const expiresIn = Number(body['expires_in'] ?? 3600);
    return {
      access_token: String(body['access_token']),
      refresh_token: String(body['refresh_token']),
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user: body['user'] as AdminSession['user'],
    };
  }

  private async readBody(response: Response): Promise<any> {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}
