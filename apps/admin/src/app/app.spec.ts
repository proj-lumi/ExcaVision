import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import { ManufacturedNode, MonitoringUnit, ServiceRequest, ServiceRequestTarget } from './admin-api';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the staff sign-in screen without a session', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Admin sign in');
  });

  it('should use plain-language request stages', () => {
    const app = TestBed.createComponent(App).componentInstance;
    expect(app.requestStageLabel('clarification_needed')).toBe('Clarifying details');
    expect(app.requestStageLabel('proposal_ready')).toBe('Proposal sent');
    expect(app.requestStageLabel('closed', 'not_proceeding')).toBe('Not proceeding');
    expect(app.requestStageLabel('closed', 'cancelled')).toBe('Cancelled');
  });

  it('should separate pre-approval closure from approved cancellation', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const newRequest = {
      id: 'request-new',
      status: 'under_review',
      service_status: 'pending',
    } as ServiceRequest;
    const approvedRequest = {
      id: 'request-approved',
      status: 'approved',
      service_status: 'pending',
      created_site_id: null,
      created_pipe_id: null,
      fulfillment_path: null,
    } as ServiceRequest;

    expect(app.requestCloseActionLabel(newRequest)).toBe('Not proceeding');
    expect(app.canDeleteRequest(newRequest)).toBe(true);
    expect(app.requestCloseActionLabel(approvedRequest)).toBe('Cancel request');
    expect(app.canDeleteRequest(approvedRequest)).toBe(false);
  });

  it('should integrate intake and work queue tabs into the request panel', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.api.session.set({
      access_token: 'test',
      refresh_token: 'test',
      expires_at: Number.MAX_SAFE_INTEGER,
      user: { id: 'admin-test' },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const workspace = fixture.nativeElement.querySelector('.request-workspace') as HTMLElement;
    const tabs = workspace?.querySelectorAll('.request-queue-tabs [role="tab"]');
    expect(tabs?.length).toBe(2);
    expect(tabs?.[0].textContent).toContain('Intake review');
    expect(tabs?.[1].textContent).toContain('Work queue');
    expect(fixture.nativeElement.querySelector('.request-queue-switcher')).toBeNull();
  });

  it('should render a required reason before confirming cancellation', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.api.session.set({
      access_token: 'test',
      refresh_token: 'test',
      expires_at: Number.MAX_SAFE_INTEGER,
      user: { id: 'admin-test' },
    });
    app.openCloseRequest({
      id: 'request-1',
      status: 'approved',
      service_status: 'pending',
      location_name: 'Test site',
      request_type: 'Request installation',
      created_site_id: null,
      created_pipe_id: null,
      fulfillment_path: null,
    } as ServiceRequest);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toContain('Cancel request');
    expect(dialog.querySelector('textarea[required]')).toBeTruthy();
    expect(dialog.querySelector<HTMLButtonElement>('.danger-button')?.disabled).toBe(true);
  });

  it('should describe reversible plans separately from started work', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const request = {
      id: 'request-1',
      status: 'approved',
      service_status: 'in_progress',
      created_site_id: 'site-1',
      created_pipe_id: 'unit-1',
      created_pipe_status: 'planning',
      fulfillment_path: 'multi_unit_service',
    } as ServiceRequest;

    expect(app.requestCloseActionLabel(request)).toBe('Cancel work');
    request.created_pipe_status = 'installation';
    expect(app.requestCloseActionLabel(request)).toBe('Stop remaining work');
    request.service_status = 'completed';
    expect(app.requestCloseActionLabel(request)).toBeNull();
  });

  it('should use serial numbers for node identity in manifests', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.manifestNodes.set([{
      id: 'node-1',
      serial_number: 'NODE-0001',
      mac_addr: 'AA:AA:AA:AA:AA:AA',
    } as ManufacturedNode]);
    expect(app.manifestNodeLabel('node-1')).toBe('NODE-0001|AA:AA:AA:AA:AA:AA');
  });

  it('should format MAC addresses while the user types', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.formatMacInput('aabb.ccdd-eeff');
    expect(app.nodeMacInput).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('should normalize customer invitation contact fields while typing', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.inviteCustomerName = 'Maria Santos';
    app.onInviteCustomerEmailChange(' Maria.Santos@Example.COM ');
    app.onInviteCustomerPhoneChange('+63 912 345 6789');

    expect(app.inviteCustomerEmail).toBe('maria.santos@example.com');
    expect(app.inviteCustomerPhone).toBe('0912 345 6789');
    expect(app.inviteCustomerFormValid()).toBe(true);
  });

  it('should reject incomplete customer invitation contact fields', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.inviteCustomerName = 'M';
    app.onInviteCustomerEmailChange('not-an-email');
    app.onInviteCustomerPhoneChange('0912');

    expect(app.inviteCustomerFormValid()).toBe(false);
  });

  it('should ask for an installation unit plan before creating units', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const request = {
      id: 'installation-1',
      status: 'approved',
      request_type: 'Request installation',
      created_site_id: 'site-1',
      created_pipe_id: null,
      fulfillment_path: null,
      service_status: 'pending',
    } as ServiceRequest;

    expect(app.requestNextStep(request)).toBe('Name and plan monitoring units.');
    expect(app.requestNeedsDeliveryAction(request)).toBe(true);

    app.openInstallationUnitPlan(request);
    expect(app.installationUnitPlanTargets).toHaveLength(1);
    expect(app.installationUnitPlanValid()).toBe(false);
    app.installationUnitPlanTargets[0].name = 'North wing';
    app.addInstallationUnitPlanTarget();
    app.installationUnitPlanTargets[1].name = 'north WING';
    expect(app.installationUnitPlanValid()).toBe(false);
    app.installationUnitPlanTargets[1].name = 'South wing';
    expect(app.installationUnitPlanTargets).toHaveLength(2);
    expect(app.installationUnitPlanValid()).toBe(true);
    app.removeInstallationUnitPlanTarget(0);
    expect(app.installationUnitPlanTargets).toEqual([{ key: 2, name: 'South wing' }]);
  });

  it('should save named installation units as one plan', async () => {
    const app = TestBed.createComponent(App).componentInstance;
    const request = {
      id: 'installation-2',
      status: 'approved',
      request_type: 'Request installation',
      created_site_id: 'site-1',
    } as ServiceRequest;
    const savePlan = vi.spyOn(app.api, 'saveInstallationUnitPlan').mockResolvedValue();

    app.openInstallationUnitPlan(request);
    app.installationUnitPlanTargets[0].name = '  North wing  ';
    app.addInstallationUnitPlanTarget();
    app.installationUnitPlanTargets[1].name = 'South wing';
    await app.saveInstallationUnitPlan();

    expect(savePlan).toHaveBeenCalledWith('installation-2', ['North wing', 'South wing']);
  });

  it('should stop suggesting installation after monitoring is active', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const request = {
      status: 'approved',
      request_type: 'Request installation',
      created_site_id: 'site-1',
      created_pipe_id: 'unit-1',
    } as ServiceRequest;
    app.units.set([
      { id: 'unit-1', site_id: 'site-1', deployment_status: 'ready' } as MonitoringUnit,
    ]);

    expect(app.requestMonitoringActive(request)).toBe(true);
    expect(app.requestNextStep(request)).toBe('Monitoring active.');
  });

  it('should treat planned installation units as equal unfinished work', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const request = {
      id: 'installation-3',
      status: 'approved',
      request_type: 'Request installation',
      created_site_id: 'site-1',
      fulfillment_path: 'multi_unit_service',
      service_status: 'in_progress',
    } as ServiceRequest;
    app.requestTargets.set([
      { id: 'target-1', service_request_id: request.id, target_kind: 'new_unit', created_pipe_id: 'unit-1', planned_unit_name: 'North wing' } as ServiceRequestTarget,
      { id: 'target-2', service_request_id: request.id, target_kind: 'new_unit', created_pipe_id: 'unit-2', planned_unit_name: 'South wing' } as ServiceRequestTarget,
    ]);
    app.units.set([
      { id: 'unit-1', site_id: 'site-1', deployment_status: 'planning' } as MonitoringUnit,
      { id: 'unit-2', site_id: 'site-1', deployment_status: 'planning' } as MonitoringUnit,
    ]);

    expect(app.installationPlanNeeded(request)).toBe(false);
    expect(app.requestNextStep(request)).toBe('Set up the planned units.');
  });

  it('should expose default collection filters and reset them after leaving a view', () => {
    const app = TestBed.createComponent(App).componentInstance;
    expect(app.requestFilter()).toBe('needs-action');
    expect(app.unitFilter).toBe('all');
    expect(app.nodeFilter).toBe('all');
    expect(app.requestFilterOptions.map((option) => option.value)).toEqual(['needs-action', 'approved', 'finished', 'all']);

    app.unitFilter = 'active';
    app.nodeFilter = 'deployed';
    app.selectView('deployments');
    app.selectView('requests');
    expect(app.unitFilter).toBe('all');
    app.selectView('inventory');
    app.selectView('requests');
    expect(app.nodeFilter).toBe('all');
  });

  it('should label multi-target completion by request type', () => {
    const app = TestBed.createComponent(App).componentInstance;
    expect(app.requestCompletionLabel({ request_type: 'Request repair' } as ServiceRequest)).toBe('Complete repair');
    expect(app.requestCompletionLabel({ request_type: 'Request more sensors' } as ServiceRequest)).toBe('Complete coverage');
  });

  it('should keep coverage quantities out of destination routing', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.coverageTargets = [];
    app.addCoverageTarget();

    expect(app.coverageTargets[0]).toEqual({
      target_kind: 'existing_unit',
      operation: 'expand_nodes',
      site_id: '',
      pipe_id: '',
    });
  });

  it('should require an execution plan for existing-unit coverage', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const request = {
      id: 'request-coverage',
      status: 'approved',
      request_type: 'Request more sensors',
      fulfillment_path: 'multi_unit_service',
      service_status: 'in_progress',
    } as ServiceRequest;
    const target = {
      id: 'target-1',
      service_request_id: request.id,
      target_kind: 'existing_unit',
      operation: 'expand_nodes',
      requested_node_count: 2,
      added_node_count: 0,
      work_plan_confirmed: false,
      completed_at: null,
    } as ServiceRequestTarget;
    app.requestTargets.set([target]);

    expect(app.requestNextStep(request)).toBe('Plan coverage.');
    expect(app.coverageTargetsComplete(request)).toBe(false);

    target.work_plan_confirmed = true;
    target.added_node_count = 2;
    expect(app.coverageTargetsComplete(request)).toBe(true);
  });

  it('should finish repairs explicitly instead of using a requested count', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const target = {
      target_kind: 'existing_unit',
      operation: 'replace_nodes',
      requested_node_count: 1,
      added_node_count: 3,
      work_plan_confirmed: true,
      completed_at: null,
    } as ServiceRequestTarget;

    expect(app.serviceTargetComplete(target)).toBe(false);
    target.completed_at = '2026-09-13T00:00:00Z';
    expect(app.serviceTargetComplete(target)).toBe(true);
  });

  it('should route approved repairs instead of offering site creation', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const request = {
      status: 'approved',
      request_type: 'Request repair',
      fulfillment_path: null,
    } as ServiceRequest;

    expect(app.requestNeedsDeliveryAction(request)).toBe(true);
    expect(app.requestNextStep(request)).toBe('Select monitoring units.');
  });

  it('should use the customer site for more-coverage routing', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const request = {
      id: 'request-coverage-site',
      status: 'approved',
      request_type: 'Request more sensors',
      site_id: 'site-1',
      fulfillment_path: null,
    } as ServiceRequest;

    expect(app.requestNextStep(request)).toBe('Plan coverage targets.');
    app.requests.set([request]);
    app.openRouteRequest(request);
    expect(app.coverageTargets[0].site_id).toBe('site-1');
  });

  it('should expose unfinished coverage work from Installations', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const target = {
      id: 'coverage-target',
      target_kind: 'existing_unit',
      operation: 'expand_nodes',
      pipe_id: 'unit-1',
      work_plan_confirmed: true,
      requested_node_count: 2,
      added_node_count: 1,
      completed_at: null,
    } as ServiceRequestTarget;
    app.requestTargets.set([target]);

    expect(app.pendingCoverageTargetForUnit({ id: 'unit-1' } as MonitoringUnit)?.id).toBe('coverage-target');
    target.added_node_count = 2;
    expect(app.pendingCoverageTargetForUnit({ id: 'unit-1' } as MonitoringUnit)).toBeNull();
  });

  it('should calculate bounded collection pages', () => {
    const app = TestBed.createComponent(App).componentInstance;
    expect(app.pageCount(101, 25)).toBe(5);
    expect(app.pageStart(5, 25, 101)).toBe(101);
    expect(app.pageEnd(5, 25, 101)).toBe(101);
  });

  it('should use the active target row query for route pickers', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.routeUnitQueries = { 0: 'first unit', 1: 'second unit' };
    app.routeSiteQueries = { 0: 'first site', 1: 'second site' };
    vi.spyOn(app, 'loadUnitOptions').mockResolvedValue();
    vi.spyOn(app, 'loadSiteOptions').mockResolvedValue();

    app.openRoutePicker('unit', 1);
    expect(app.optionUnitSearch).toBe('second unit');
    app.openRoutePicker('site', 1);
    expect(app.optionSiteSearch).toBe('second site');
  });

  it('should explain empty picker searches instead of showing a blank panel', () => {
    const app = TestBed.createComponent(App).componentInstance;
    expect(app.pickerEmptyMessage('')).toBe('Type to search');
    expect(app.pickerEmptyMessage(undefined)).toBe('Type to search');
    expect(app.pickerEmptyMessage('a')).toBe('Type one more character');
  });

  it('should not query picker collections until two characters are entered', async () => {
    const app = TestBed.createComponent(App).componentInstance;
    const searchUnits = vi.spyOn(app.api, 'searchMonitoringUnits');
    const searchSites = vi.spyOn(app.api, 'searchSites');
    app.optionUnitSearch = '';
    app.optionSiteSearch = 'a';

    await app.loadUnitOptions();
    await app.loadSiteOptions();

    expect(searchUnits).not.toHaveBeenCalled();
    expect(searchSites).not.toHaveBeenCalled();
  });

  it('should expose a collection placeholder before database results', async () => {
    vi.useFakeTimers();
    try {
      const app = TestBed.createComponent(App).componentInstance;
      vi.spyOn(app.api, 'listSitesPage').mockResolvedValue({ items: [], total: 0 });

      const loading = app.loadSitesPage();
      expect(app.sitesLoading()).toBe(true);
      await vi.advanceTimersByTimeAsync(180);
      await loading;
      expect(app.sitesLoading()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should keep the newest collection response when searches overlap', async () => {
    vi.useFakeTimers();
    try {
      const app = TestBed.createComponent(App).componentInstance;
      let resolveFirst!: (value: Awaited<ReturnType<typeof app.api.listSitesPage>>) => void;
      let resolveSecond!: (value: Awaited<ReturnType<typeof app.api.listSitesPage>>) => void;
      const first = new Promise<Awaited<ReturnType<typeof app.api.listSitesPage>>>((resolve) => { resolveFirst = resolve; });
      const second = new Promise<Awaited<ReturnType<typeof app.api.listSitesPage>>>((resolve) => { resolveSecond = resolve; });
      vi.spyOn(app.api, 'listSitesPage')
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);

      app.siteSearch = 'old';
      const oldLoad = app.loadSitesPage();
      app.siteSearch = 'new';
      const newLoad = app.loadSitesPage();
      resolveSecond({ items: [{ id: 'new-site', name: 'New site', lat: null, lon: null, created_at: '' }], total: 1 });
      await vi.advanceTimersByTimeAsync(180);
      await newLoad;
      expect(app.sites().map((site) => site.id)).toEqual(['new-site']);

      resolveFirst({ items: [{ id: 'old-site', name: 'Old site', lat: null, lon: null, created_at: '' }], total: 1 });
      await oldLoad;
      expect(app.sites().map((site) => site.id)).toEqual(['new-site']);
      expect(app.sitesLoading()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should validate manifests from server-provided counts', () => {
    const app = TestBed.createComponent(App).componentInstance;
    const unit = {
      plan_confirmed: true,
      expected_node_count: 3,
      node_count: 3,
      gateway_count: 1,
    } as MonitoringUnit;
    expect(app.manifestReady(unit)).toBe(true);
    unit.gateway_count = 0;
    expect(app.manifestReady(unit)).toBe(false);
  });

  it('should allow removing the final assigned node from a planning manifest', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.manifestUnit.set({ node_count: 1 } as MonitoringUnit);
    app.manifestDraft = [{ registry_id: 'node-1', position: 1 }];
    app.removeManifestNode(0);
    expect(app.manifestDraft).toEqual([]);
  });

  it('should allow an empty planning manifest before hardware is assigned', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.unitNodeCountInput = 2;
    app.manifestDraft = [];
    expect(app.hardwareSetupIssue()).toBe('');
  });

  it('should block a hardware target below the assigned count', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.unitNodeCountInput = 1;
    app.manifestDraft = [
      { registry_id: 'node-1', position: 1 },
      { registry_id: 'node-2', position: 2 },
    ];

    expect(app.hardwareSetupIssue()).toContain('cannot be lower than 2 assigned nodes');
  });

  it('should derive the gateway from whichever node is first in the chain', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.manifestDraft = [
      { registry_id: 'node-1', position: 1 },
      { registry_id: 'node-2', position: 2 },
    ];

    app.moveManifestNode('node-2', -1);

    expect(app.manifestDraft[0]).toEqual({ registry_id: 'node-2', position: 1 });
  });

  it('should shift occupied positions and immediately sort the manifest', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.manifestDraft = [
      { registry_id: 'node-1', position: 1 },
      { registry_id: 'node-2', position: 2 },
      { registry_id: 'node-3', position: 3 },
    ];

    app.moveManifestNode('node-3', -1);
    app.moveManifestNode('node-3', -1);

    expect(app.manifestDraft.map((node) => [node.registry_id, node.position])).toEqual([
      ['node-3', 1],
      ['node-1', 2],
      ['node-2', 3],
    ]);
    expect(new Set(app.manifestDraft.map((node) => node.position)).size).toBe(3);
  });

  it('should keep keyboard movement inside the assigned contiguous range', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.manifestDraft = [
      { registry_id: 'node-1', position: 1 },
      { registry_id: 'node-2', position: 2 },
      { registry_id: 'node-3', position: 3 },
    ];

    app.moveManifestNode('node-1', 1);

    expect(app.manifestDraft.map((node) => node.position)).toEqual([1, 2, 3]);
    expect(app.manifestDraft[1].registry_id).toBe('node-1');
  });

  it('should not lower the target below the assigned chain length', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.unitNodeCountInput = 5;
    app.manifestDraft = [
      { registry_id: 'node-1', position: 1 },
      { registry_id: 'node-2', position: 2 },
      { registry_id: 'node-3', position: 3 },
    ];

    app.setHardwareTarget(1);

    expect(app.unitNodeCountInput).toBe(3);
  });

  it('should require every field check before commissioning completes', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.hardwareMountedCheck = true;
    app.rs485Check = true;
    app.gatewayOnlineCheck = true;
    app.readingsReceivedCheck = true;
    expect(app.allCommissioningChecksComplete()).toBe(false);
    app.baselineCapturedCheck = true;
    expect(app.allCommissioningChecksComplete()).toBe(true);
  });
});
