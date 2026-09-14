import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AppSelect, AppSelectOption } from './app-select';
import { InstallationsFeature } from './installations-feature';
import { InventoryFeature } from './inventory-feature';
import { RequestsFeature } from './requests-feature';
import {
  AdminApi,
  ManufacturedNode,
  MonitoringUnit,
  ServiceRequest,
  ServiceRequestIntake,
  ServiceRequestTarget,
  Site,
} from './admin-api';

type View = 'requests' | 'sites' | 'inventory' | 'deployments';
type RequestFilter = 'needs-action' | 'approved' | 'finished' | 'all';
type RequestTypeFilter = 'all' | 'Request installation' | 'Request repair' | 'Request more sensors';
type RequestRoute =
  | 'repair_existing_unit'
  | 'expand_existing_unit'
  | 'new_unit_existing_site';
type ModalKind =
  | 'review-intake'
  | 'invite-customer'
  | 'route-request'
  | 'installation-unit-plan'
  | 'service-target-plan'
  | 'replace-node'
  | 'create-site'
  | 'edit-site'
  | 'create-unit'
  | 'edit-unit'
  | 'create-node'
  | 'deploy-node'
  | 'manifest'
  | 'hardware-setup'
  | 'commissioning'
  | 'close-request'
  | 'delete';
type DeleteKind = 'request' | 'site' | 'unit' | 'node';
type OverflowKind = 'request' | 'site' | 'node';

interface OverflowMenuState {
  kind: OverflowKind;
  id: string;
  left: number;
  top: number;
}

interface DeleteTarget {
  kind: DeleteKind;
  id: string;
  label: string;
  warning: string;
}

interface IntakeReviewTarget {
  intake: ServiceRequestIntake;
  disposition: 'rejected' | 'spam';
}

interface CloseRequestTarget {
  request: ServiceRequest;
  actionLabel: 'Not proceeding' | 'Cancel request' | 'Cancel work' | 'Stop remaining work';
}

interface InstallationGroup {
  id: 'planning' | 'field-work' | 'active';
  title: string;
  units: MonitoringUnit[];
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, AppSelect, InstallationsFeature, InventoryFeature, RequestsFeature],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnDestroy {
  readonly featureVm = this;
  readonly api = inject(AdminApi);
  readonly activeView = signal<View>('requests');
  readonly menuOpen = signal(false);
  readonly loading = signal(false);
  readonly intakesLoading = signal(false);
  readonly requestsLoading = signal(false);
  readonly sitesLoading = signal(false);
  readonly unitsLoading = signal(false);
  readonly nodesLoading = signal(false);
  readonly siteOptionsLoading = signal(false);
  readonly unitOptionsLoading = signal(false);
  readonly availableNodeOptionsLoading = signal(false);
  readonly replacementNodeOptionsLoading = signal(false);
  readonly replacementUnitNodesLoading = signal(false);
  readonly notice = signal('');
  readonly error = signal('');
  readonly requestRealtimeStatus = signal<'connecting' | 'live' | 'offline'>('offline');
  readonly requestFilter = signal<RequestFilter>('needs-action');
  readonly selectedIntakeId = signal<string | null>(null);
  readonly selectedRequestId = signal<string | null>(null);
  readonly modal = signal<ModalKind | null>(null);
  readonly overflowMenu = signal<OverflowMenuState | null>(null);
  readonly overflowRequest = computed(() => {
    const menu = this.overflowMenu();
    return menu?.kind === 'request' ? this.requests().find((request) => request.id === menu.id) ?? null : null;
  });
  readonly overflowSite = computed(() => {
    const menu = this.overflowMenu();
    return menu?.kind === 'site' ? this.sites().find((site) => site.id === menu.id) ?? null : null;
  });
  readonly overflowNode = computed(() => {
    const menu = this.overflowMenu();
    return menu?.kind === 'node' ? this.nodes().find((node) => node.id === menu.id) ?? null : null;
  });
  readonly deleteTarget = signal<DeleteTarget | null>(null);
  readonly intakeReviewTarget = signal<IntakeReviewTarget | null>(null);
  readonly inviteCustomerSite = signal<Site | null>(null);
  readonly closeRequestTarget = signal<CloseRequestTarget | null>(null);
  readonly installationUnitPlanRequest = signal<ServiceRequest | null>(null);
  readonly serviceTargetPlan = signal<ServiceRequestTarget | null>(null);

  readonly intakes = signal<ServiceRequestIntake[]>([]);
  readonly requests = signal<ServiceRequest[]>([]);
  readonly requestTargets = signal<ServiceRequestTarget[]>([]);
  readonly installationTargets = signal<ServiceRequestTarget[]>([]);
  readonly sites = signal<Site[]>([]);
  readonly units = signal<MonitoringUnit[]>([]);
  readonly nodes = signal<ManufacturedNode[]>([]);
  readonly intakeTotal = signal(0);
  readonly requestTotal = signal(0);
  readonly siteTotal = signal(0);
  readonly unitTotal = signal(0);
  readonly nodeTotal = signal(0);
  readonly intakePage = signal(1);
  readonly requestPage = signal(1);
  readonly sitePage = signal(1);
  readonly unitPage = signal(1);
  readonly nodePage = signal(1);
  readonly siteOptions = signal<Site[]>([]);
  readonly unitOptions = signal<MonitoringUnit[]>([]);
  readonly availableNodeOptions = signal<ManufacturedNode[]>([]);
  readonly replacementNodeOptions = signal<ManufacturedNode[]>([]);
  readonly replacementUnitNodes = signal<ManufacturedNode[]>([]);
  readonly replacementSensorOptions = computed<AppSelectOption[]>(() => [
    { value: '', label: 'Select node' },
    ...this.replacementUnitNodes().map((node) => ({
      value: node.deployed_node_id ?? node.id,
      label: `Position ${node.position_in_pipe}: ${node.serial_number}${node.position_in_pipe === 1 ? ' (Gateway)' : ''}`,
    })),
  ]);
  replacementNodeQuery = '';
  replacementNodePickerOpen = false;
  readonly manifestUnit = signal<MonitoringUnit | null>(null);
  readonly manifestNodes = signal<ManufacturedNode[]>([]);
  readonly manifestLoading = signal(false);
  manifestDraft: Array<{ registry_id: string; position: number }> = [];
  nodeAddSheetOpen = false;

  readonly selectedIntake = computed(() => {
    const id = this.selectedIntakeId();
    return this.intakes().find((intake) => intake.id === id) ?? null;
  });
  readonly filteredRequests = computed(() => this.requests());
  readonly selectedRequest = computed(() => {
    const id = this.selectedRequestId();
    return this.requests().find((request) => request.id === id) ?? null;
  });
  readonly availableNodes = computed(() => this.availableNodeOptions());
  readonly installationGroups = computed<InstallationGroup[]>(() => {
    const units = this.units();
    return [
      {
        id: 'planning',
        title: 'Planning',
        units: units.filter((unit) => unit.deployment_status === 'planning'),
      },
      {
        id: 'field-work',
        title: 'Field work',
        units: units.filter((unit) => ['installation', 'commissioning'].includes(unit.deployment_status)),
      },
      {
        id: 'active',
        title: 'Monitoring active',
        units: units.filter((unit) => unit.deployment_status === 'ready'),
      },
    ].filter((group) => group.units.length > 0) as InstallationGroup[];
  });

  private readonly feedbackEffect = effect((onCleanup) => {
    const message = this.error() || this.notice();
    if (!message) return;
    const dismissTimer = setTimeout(() => this.clearFeedback(), 4200);
    onCleanup(() => clearTimeout(dismissTimer));
  });

  readonly intakeFilterOptions: readonly AppSelectOption[] = [
    { value: 'pending', label: 'Needs review' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'spam', label: 'Spam' },
    { value: 'all', label: 'All intake' },
  ];
  readonly requestFilterOptions: readonly AppSelectOption[] = [
    { value: 'needs-action', label: 'Needs action' },
    { value: 'approved', label: 'Approved' },
    { value: 'finished', label: 'Finished' },
    { value: 'all', label: 'All stages' },
  ];
  readonly requestTypeOptions: readonly AppSelectOption[] = [
    { value: 'all', label: 'All request types' },
    { value: 'Request installation', label: 'New installation' },
    { value: 'Request repair', label: 'Repair or service' },
    { value: 'Request more sensors', label: 'More coverage' },
  ];
  readonly nodeAssignmentOptions: readonly AppSelectOption[] = [
    { value: 'all', label: 'All assignments' },
    { value: 'assigned', label: 'Assigned' },
    { value: 'unassigned', label: 'Unassigned' },
  ];
  readonly nodeFilterOptions: readonly AppSelectOption[] = [
    { value: 'all', label: 'All states' },
    { value: 'available', label: 'Available' },
    { value: 'deployed', label: 'Deployed' },
    { value: 'retired', label: 'Retired' },
  ];
  readonly unitFilterOptions: readonly AppSelectOption[] = [
    { value: 'all', label: 'All stages' },
    { value: 'planning', label: 'Planning' },
    { value: 'field-work', label: 'Field work' },
    { value: 'active', label: 'Monitoring active' },
  ];
  readonly targetKindOptions: readonly AppSelectOption[] = [
    { value: 'existing_unit', label: 'Add nodes to an existing unit' },
    { value: 'new_unit', label: 'Create a unit at an existing site' },
  ];
  readonly intakePageSize = 25;
  readonly requestPageSize = 25;
  readonly sitePageSize = 24;
  readonly unitPageSize = 18;
  readonly nodePageSize = 50;

  email = '';
  password = '';
  requestWorkspaceMode: 'intake' | 'work' = 'intake';
  intakeFilter: 'pending' | 'accepted' | 'rejected' | 'spam' | 'all' = 'pending';
  intakeSearch = '';
  intakeReviewReason = '';
  requestSearch = '';
  requestTypeFilter: RequestTypeFilter = 'all';
  siteSearch = '';
  unitSearch = '';
  nodeSearch = '';
  unitFilter: 'all' | 'planning' | 'field-work' | 'active' = 'all';
  nodeFilter: 'all' | 'available' | 'deployed' | 'retired' = 'all';
  nodeAssignmentFilter: 'all' | 'assigned' | 'unassigned' = 'all';
  optionSiteSearch = '';
  optionUnitSearch = '';
  optionNodeSearch = '';
  routeUnitQueries: Record<number, string> = {};
  routeSiteQueries: Record<number, string> = {};
  routePickerOpen: { kind: 'unit' | 'site'; index: number } | null = null;

  selectedSiteRequestId = '';
  siteNameInput = '';
  inviteCustomerName = '';
  inviteCustomerEmail = '';
  inviteCustomerPhone = '';
  inviteCustomerCompany = '';
  editingSiteId = '';

  routeRequestId = '';
  routePath: RequestRoute = 'repair_existing_unit';
  routeSiteId = '';
  routeUnitId = '';
  coverageTargets: Array<{ target_kind: 'existing_unit' | 'new_unit'; operation: 'expand_nodes' | 'replace_nodes' | 'install_unit'; site_id: string; pipe_id: string }> = [];
  serviceTargetNodeCountInput = 1;
  installationUnitPlanTargets: Array<{ key: number; name: string }> = [{ key: 1, name: '' }];
  private nextInstallationUnitPlanKey = 2;

  unitRequestId = '';
  unitTargetId = '';
  unitSiteId = '';
  unitNameInput = '';
  unitNodeCountInput = 3;
  unitThresholdInput = 2;
  editingUnitId = '';


  nodeMacInput = '';

  deployNodeId = '';
  deployNodeQuery = '';
  deployNodePickerOpen = false;
  deployNodeActiveIndex = -1;
  deployUnitId = '';
  deployTargetId = '';
  deployPosition = 1;

  replacementTargetId = '';
  replacementUnitId = '';
  replacementSensorNodeId = '';
  replacementRegistryId = '';

  commissioningUnitId = '';
  commissioningNotesInput = '';
  closeRequestReason = '';
  hardwareMountedCheck = false;
  rs485Check = false;
  gatewayOnlineCheck = false;
  readingsReceivedCheck = false;
  baselineCapturedCheck = false;

  private stopRequestListener: (() => void) | null = null;
  private requestRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pickerSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private routeSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private collectionSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private intakeLoadRevision = 0;
  private requestLoadRevision = 0;
  private siteLoadRevision = 0;
  private unitLoadRevision = 0;
  private nodeLoadRevision = 0;
  private siteOptionsLoadRevision = 0;
  private unitOptionsLoadRevision = 0;
  private availableNodeLoadRevision = 0;
  private replacementNodeLoadRevision = 0;
  private replacementUnitLoadRevision = 0;
  private manifestLoadRevision = 0;
  private readonly minimumPlaceholderMs = 180;
  private overflowTrigger: HTMLButtonElement | null = null;

  constructor() {
    if (this.api.session()) {
      queueMicrotask(async () => {
        await this.loadAll();
        await this.startRequestListener();
      });
    }
  }

  ngOnDestroy(): void {
    this.stopListeningForRequests();
    if (this.pickerSearchTimer) clearTimeout(this.pickerSearchTimer);
    if (this.routeSearchTimer) clearTimeout(this.routeSearchTimer);
    if (this.collectionSearchTimer) clearTimeout(this.collectionSearchTimer);
    document.body.classList.remove('modal-open');
  }

  @HostListener('document:mousedown', ['$event'])
  closePickersOnOutsideClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.routePickerOpen && !target.closest('.route-picker')) this.routePickerOpen = null;
    if (this.replacementNodePickerOpen && !target.closest('.node-picker')) this.replacementNodePickerOpen = false;
    if (this.deployNodePickerOpen && !target.closest('.node-picker')) this.deployNodePickerOpen = false;
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    if (this.overflowMenu()) {
      this.closeOverflowMenu();
      return;
    }
    if (this.modal() && !this.loading()) this.closeModal();
  }

  async signIn(): Promise<void> {
    this.clearMessages();
    if (!this.email.trim() || !this.password) {
      this.error.set('Enter your staff email and password.');
      return;
    }
    this.loading.set(true);
    try {
      await this.api.signIn(this.email.trim(), this.password);
      this.password = '';
      await this.loadAll();
      await this.startRequestListener();
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.loading.set(false);
    }
  }

  signOut(): void {
    this.closeModal();
    this.stopListeningForRequests();
    this.api.signOut();
    this.intakes.set([]);
    this.requests.set([]);
    this.requestTargets.set([]);
    this.installationTargets.set([]);
    this.sites.set([]);
    this.units.set([]);
    this.nodes.set([]);
    this.activeView.set('requests');
  }

  selectView(view: View): void {
    const previousView = this.activeView();
    const viewChanged = previousView !== view;
    if (viewChanged && previousView !== view) this.resetViewState(previousView);
    this.activeView.set(view);
    this.menuOpen.set(false);
    this.clearMessages();
    if (view === 'requests') {
      if (this.requestWorkspaceMode === 'intake') this.ensureSelectedIntake();
      else this.ensureSelectedRequest();
    }
  }

  selectIntake(intake: ServiceRequestIntake): void {
    if (this.selectedIntakeId() === intake.id) return;
    this.selectedIntakeId.set(intake.id);
  }

  selectRequest(request: ServiceRequest): void {
    if (this.selectedRequestId() === request.id) return;
    this.selectedRequestId.set(request.id);
  }

  setRequestWorkspaceMode(mode: string): void {
    this.requestWorkspaceMode = mode as typeof this.requestWorkspaceMode;
    if (this.requestWorkspaceMode === 'intake') {
      this.ensureSelectedIntake();
      void this.loadIntakesPage();
    } else {
      this.ensureSelectedRequest();
      void this.loadRequestsPage();
    }
  }

  setIntakeFilter(filter: string): void {
    this.intakeFilter = filter as typeof this.intakeFilter;
    this.intakePage.set(1);
    void this.loadIntakesPage();
  }

  setRequestFilter(filter: string): void {
    this.requestFilter.set(filter as RequestFilter);
    this.requestPage.set(1);
    void this.loadRequestsPage();
  }

  setRequestTypeFilter(filter: string): void {
    this.requestTypeFilter = filter as RequestTypeFilter;
    this.requestPage.set(1);
    void this.loadRequestsPage();
  }

  async loadAll(): Promise<void> {
    if (!this.api.session()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      await Promise.all([
        this.loadIntakesPage(),
        this.loadRequestsPage(),
        this.loadSitesPage(),
        this.loadUnitsPage(),
        this.loadNodesPage(),
      ]);
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.loading.set(false);
    }
  }

  async loadIntakesPage(): Promise<void> {
    const revision = ++this.intakeLoadRevision;
    const startedAt = performance.now();
    this.intakesLoading.set(true);
    try {
      const result = await this.api.listRequestIntakesPage({
        search: this.intakeSearch,
        filter: this.intakeFilter,
        page: this.intakePage(),
        pageSize: this.intakePageSize,
      });
      await this.holdPlaceholder(startedAt);
      if (revision !== this.intakeLoadRevision) return;
      this.intakes.set(result.items);
      this.intakeTotal.set(result.total);
      this.ensureSelectedIntake();
    } finally {
      if (revision === this.intakeLoadRevision) this.intakesLoading.set(false);
    }
  }

  async loadRequestsPage(): Promise<void> {
    const revision = ++this.requestLoadRevision;
    const startedAt = performance.now();
    this.requestsLoading.set(true);
    try {
      const result = await this.api.listRequestsPage({
        search: this.requestSearch,
        filter: this.requestFilter(),
        requestType: this.requestTypeFilter,
        page: this.requestPage(),
        pageSize: this.requestPageSize,
      });
      const targets = await this.api.listTargetsForRequests(result.items.map((request) => request.id));
      await this.holdPlaceholder(startedAt);
      if (revision !== this.requestLoadRevision) return;
      this.requests.set(result.items);
      this.requestTotal.set(result.total);
      this.requestTargets.set(targets);
      this.ensureSelectedRequest();
    } finally {
      if (revision === this.requestLoadRevision) this.requestsLoading.set(false);
    }
  }

  async loadSitesPage(): Promise<void> {
    const revision = ++this.siteLoadRevision;
    const startedAt = performance.now();
    this.sitesLoading.set(true);
    try {
      const result = await this.api.listSitesPage(this.siteSearch, this.sitePage(), this.sitePageSize);
      await this.holdPlaceholder(startedAt);
      if (revision !== this.siteLoadRevision) return;
      this.sites.set(result.items);
      this.siteTotal.set(result.total);
    } finally {
      if (revision === this.siteLoadRevision) this.sitesLoading.set(false);
    }
  }

  async loadUnitsPage(): Promise<void> {
    const revision = ++this.unitLoadRevision;
    const startedAt = performance.now();
    this.unitsLoading.set(true);
    try {
      const result = await this.api.listMonitoringUnitsPage({
        search: this.unitSearch,
        filter: this.unitFilter,
        page: this.unitPage(),
        pageSize: this.unitPageSize,
      });
      const installationTargets = await this.api.listPendingCoverageTargetsForUnits(result.items.map((unit) => unit.id));
      await this.holdPlaceholder(startedAt);
      if (revision !== this.unitLoadRevision) return;
      this.units.set(result.items);
      this.installationTargets.set(installationTargets);
      this.unitTotal.set(result.total);
    } finally {
      if (revision === this.unitLoadRevision) this.unitsLoading.set(false);
    }
  }

  async loadNodesPage(): Promise<void> {
    const revision = ++this.nodeLoadRevision;
    const startedAt = performance.now();
    this.nodesLoading.set(true);
    try {
      const result = await this.api.listNodesPage({
        search: this.nodeSearch,
        filter: this.nodeFilter,
        assignment: this.nodeAssignmentFilter,
        page: this.nodePage(),
        pageSize: this.nodePageSize,
      });
      await this.holdPlaceholder(startedAt);
      if (revision !== this.nodeLoadRevision) return;
      this.nodes.set(result.items);
      this.nodeTotal.set(result.total);
    } finally {
      if (revision === this.nodeLoadRevision) this.nodesLoading.set(false);
    }
  }

  searchIntakes(): void { this.intakePage.set(1); void this.loadIntakesPage(); }
  searchRequests(): void { this.requestPage.set(1); void this.loadRequestsPage(); }
  searchSites(): void { this.sitePage.set(1); void this.loadSitesPage(); }

  onIntakeSearchChange(search: string): void {
    this.intakeSearch = search;
    this.scheduleCollectionSearch(() => this.searchIntakes());
  }

  onRequestSearchChange(search: string): void {
    this.requestSearch = search;
    this.scheduleCollectionSearch(() => this.searchRequests());
  }

  onSiteSearchChange(search: string): void {
    this.siteSearch = search;
    this.scheduleCollectionSearch(() => this.searchSites());
  }

  onUnitSearchChange(search: string): void {
    this.unitSearch = search;
    this.scheduleCollectionSearch(() => this.searchUnits());
  }

  onNodeSearchChange(search: string): void {
    this.nodeSearch = search;
    this.scheduleCollectionSearch(() => this.searchNodes());
  }

  openInstallationsForSite(site: Site): void {
    this.openInstallations(site.name);
  }

  openRequestInstallation(request: ServiceRequest): void {
    this.openInstallations(request.created_pipe_name ?? '');
  }

  openTargetInstallation(target: ServiceRequestTarget): void {
    this.openInstallations(target.created_pipe_name ?? target.pipe_name ?? '');
  }

  private openInstallations(search: string): void {
    this.unitSearch = search;
    this.unitFilter = 'all';
    this.unitPage.set(1);
    this.selectView('deployments');
    void this.loadUnitsPage();
  }
  searchUnits(): void { this.unitPage.set(1); void this.loadUnitsPage(); }
  searchNodes(): void { this.nodePage.set(1); void this.loadNodesPage(); }
  filterUnits(): void { this.unitPage.set(1); void this.loadUnitsPage(); }
  filterNodes(): void { this.nodePage.set(1); void this.loadNodesPage(); }

  setUnitFilter(filter: string): void {
    this.unitFilter = filter as typeof this.unitFilter;
    this.filterUnits();
  }

  setNodeFilter(filter: string): void {
    this.nodeFilter = filter as typeof this.nodeFilter;
    this.filterNodes();
  }

  setNodeAssignmentFilter(filter: string): void {
    this.nodeAssignmentFilter = filter as typeof this.nodeAssignmentFilter;
    this.filterNodes();
  }

  setTargetKind(index: number, kind: string): void {
    const target = this.coverageTargets[index];
    if (!target) return;
    target.target_kind = kind as typeof target.target_kind;
    if (target.target_kind === 'existing_unit') {
      target.site_id = this.routeSourceRequest()?.site_id ?? target.site_id;
      target.pipe_id = '';
    } else {
      target.site_id = this.routeSourceRequest()?.site_id ?? target.site_id;
      target.pipe_id = '';
    }
  }

  setReplacementSensorNode(nodeId: string): void {
    this.replacementSensorNodeId = nodeId;
  }

  changeIntakePage(delta: number): void { this.intakePage.update((page) => page + delta); void this.loadIntakesPage(); }
  changeRequestPage(delta: number): void { this.requestPage.update((page) => page + delta); void this.loadRequestsPage(); }
  changeSitePage(delta: number): void { this.sitePage.update((page) => page + delta); void this.loadSitesPage(); }
  changeUnitPage(delta: number): void { this.unitPage.update((page) => page + delta); void this.loadUnitsPage(); }
  changeNodePage(delta: number): void { this.nodePage.update((page) => page + delta); void this.loadNodesPage(); }

  pageCount(total: number, pageSize: number): number { return Math.max(1, Math.ceil(total / pageSize)); }
  pageStart(page: number, pageSize: number, total: number): number { return total ? (page - 1) * pageSize + 1 : 0; }
  pageEnd(page: number, pageSize: number, total: number): number { return Math.min(page * pageSize, total); }

  async acceptIntake(intake: ServiceRequestIntake): Promise<void> {
    if (intake.status !== 'pending') return;
    await this.runAction(
      () => this.api.acceptRequestIntake(intake.id),
      'Installation intake accepted and added to the work queue.',
      () => this.selectedIntakeId.set(null),
    );
  }

  openIntakeReview(intake: ServiceRequestIntake, disposition: 'rejected' | 'spam'): void {
    if (intake.status !== 'pending') return;
    this.intakeReviewTarget.set({ intake, disposition });
    this.intakeReviewReason = '';
    this.openModal('review-intake');
  }

  async reviewIntake(): Promise<void> {
    const target = this.intakeReviewTarget();
    const reason = this.intakeReviewReason.trim();
    if (!target || reason.length < 3) {
      this.error.set('Enter a review reason of at least 3 characters.');
      return;
    }
    await this.runAction(
      () => this.api.rejectRequestIntake(target.intake.id, target.disposition, reason),
      target.disposition === 'spam' ? 'Intake marked as spam.' : 'Intake rejected.',
      () => this.closeModal(),
    );
  }

  async changeRequestStatus(request: ServiceRequest, status: string): Promise<void> {
    if (request.status === status) return;
    await this.runAction(
      () => this.api.updateRequestStatus(request.id, status),
      `Request moved to ${this.requestStageLabel(status)}.`,
    );
  }

  openCloseRequest(request: ServiceRequest): void {
    const actionLabel = this.requestCloseActionLabel(request);
    if (!actionLabel) return;
    this.closeRequestReason = '';
    this.closeRequestTarget.set({ request, actionLabel });
    this.openModal('close-request');
  }

  async closeServiceRequest(): Promise<void> {
    const target = this.closeRequestTarget();
    const reason = this.closeRequestReason.trim();
    if (!target) return;
    if (reason.length < 3) {
      this.error.set('Enter a reason for closing this request.');
      return;
    }

    await this.runAction(
      () => this.api.closeServiceRequest(target.request.id, reason),
      target.actionLabel === 'Not proceeding' ? 'Request marked as not proceeding.' : 'Remaining request work cancelled.',
      () => this.closeModal(),
    );
  }

  requestCloseImpact(target: CloseRequestTarget): string {
    if (target.actionLabel === 'Not proceeding') {
      return 'Closes this request before approval. No site or installation work will be changed.';
    }
    if (target.actionLabel === 'Cancel request') {
      return 'Closes this approved request. No site, unit, or hardware work has been created.';
    }
    if (target.actionLabel === 'Cancel work') {
      const request = target.request;
      const hasCreatedAssets = Boolean(
        request.created_site_id
        || request.created_pipe_id
        || this.targetsForRequest(request.id).some((item) => item.created_pipe_id),
      );
      return hasCreatedAssets
        ? 'Closes this request, hides its draft site and units, and returns planning hardware to inventory.'
        : 'Closes the planned service. Existing sites and units stay active.';
    }
    return 'Stops unfinished work. Started field work and completed changes remain preserved in the record.';
  }

  openRouteRequest(request: ServiceRequest): void {
    this.routeRequestId = request.id;
    this.optionSiteSearch = '';
    this.optionUnitSearch = '';
    this.routeUnitQueries = {};
    this.routeSiteQueries = {};
    this.routePickerOpen = null;
    void this.loadUnitOptions(request.site_id);
    this.routeSiteId = request.target_site_id ?? '';
    this.routeUnitId = request.target_pipe_id ?? '';
    this.routePath = request.fulfillment_path === 'repair_existing_unit'
      ? 'repair_existing_unit'
      : 'expand_existing_unit';
    this.coverageTargets = this.requestTargets()
      .filter((target) => target.service_request_id === request.id)
      .map((target) => ({
        target_kind: target.target_kind,
        operation: target.operation,
        site_id: request.site_id ?? target.site_id,
        pipe_id: target.pipe_id ?? '',
      }));
    if ((request.request_type === 'Request more sensors' || request.request_type === 'Request repair') && !this.coverageTargets.length) {
      this.addCoverageTarget();
    }
    this.coverageTargets.forEach((target, index) => {
      this.routeUnitQueries[index] = target.pipe_id ? this.unitName(target.pipe_id) : '';
      this.routeSiteQueries[index] = target.site_id ? this.siteName(target.site_id) : '';
    });
    this.openModal('route-request');
  }

  routeSourceRequest(): ServiceRequest | null {
    return this.requests().find((request) => request.id === this.routeRequestId) ?? null;
  }

  routeNeedsUnit(): boolean {
    return this.routePath === 'repair_existing_unit';
  }

  async loadSiteOptions(): Promise<void> {
    const revision = ++this.siteOptionsLoadRevision;
    const query = this.optionSiteSearch.trim();
    if (query.length < 2) {
      this.siteOptions.set([]);
      this.siteOptionsLoading.set(false);
      return;
    }
    const startedAt = performance.now();
    this.siteOptionsLoading.set(true);
    try {
      const results = await this.api.searchSites(this.optionSiteSearch);
      await this.holdPlaceholder(startedAt);
      if (revision !== this.siteOptionsLoadRevision) return;
      const selected = new Set(this.coverageTargets.map((target) => target.site_id).filter(Boolean));
      this.siteOptions.set(this.mergePickerOptions(results, this.siteOptions(), selected));
    } finally {
      if (revision === this.siteOptionsLoadRevision) this.siteOptionsLoading.set(false);
    }
  }

  async loadUnitOptions(siteId?: string | null): Promise<void> {
    const revision = ++this.unitOptionsLoadRevision;
    const query = this.optionUnitSearch.trim();
    if (query.length < 2) {
      this.unitOptions.set([]);
      this.unitOptionsLoading.set(false);
      return;
    }
    const startedAt = performance.now();
    this.unitOptionsLoading.set(true);
    try {
      const results = await this.api.searchMonitoringUnits(this.optionUnitSearch, 8, siteId);
      await this.holdPlaceholder(startedAt);
      if (revision !== this.unitOptionsLoadRevision) return;
      const selected = new Set([
        this.deployUnitId,
        ...this.coverageTargets.map((target) => target.pipe_id),
      ].filter(Boolean));
      this.unitOptions.set(this.mergePickerOptions(results, this.unitOptions(), selected));
    } finally {
      if (revision === this.unitOptionsLoadRevision) this.unitOptionsLoading.set(false);
    }
  }

  async loadAvailableNodeOptions(): Promise<void> {
    const revision = ++this.availableNodeLoadRevision;
    const query = this.deployNodeQuery.trim();
    if (query.length < 2) {
      this.availableNodeOptions.set([]);
      this.availableNodeOptionsLoading.set(false);
      return;
    }
    const startedAt = performance.now();
    this.availableNodeOptionsLoading.set(true);
    try {
      const results = await this.api.searchAvailableNodes(this.deployNodeQuery);
      let eligible = results;
      if (this.modal() === 'hardware-setup') {
        const assignedIds = new Set(this.manifestDraft.map((node) => node.registry_id));
        const query = this.deployNodeQuery.trim().toLowerCase();
        const removedNodes = this.manifestNodes().filter((node) =>
          !assignedIds.has(node.id) && (!query || node.serial_number.toLowerCase().includes(query) || node.mac_addr.toLowerCase().includes(query)),
        );
        eligible = [...results.filter((node) => !assignedIds.has(node.id)), ...removedNodes];
      }
      await this.holdPlaceholder(startedAt);
      if (revision !== this.availableNodeLoadRevision) return;
      this.availableNodeOptions.set(this.mergePickerOptions(eligible, this.availableNodeOptions(), new Set([this.deployNodeId].filter(Boolean))));
    } finally {
      if (revision === this.availableNodeLoadRevision) this.availableNodeOptionsLoading.set(false);
    }
  }

  openDeployNodePicker(): void {
    this.deployNodePickerOpen = true;
    this.deployNodeActiveIndex = this.availableNodeOptions().length ? 0 : -1;
    if (!this.availableNodeOptions().length) void this.loadAvailableNodeOptions();
  }

  closeDeployNodePicker(): void {
    setTimeout(() => { this.deployNodePickerOpen = false; }, 120);
  }

  deployNodePickerIsOpen(): boolean {
    return this.deployNodePickerOpen;
  }

  onDeployNodeQueryChange(query: string): void {
    this.deployNodeQuery = query;
    this.deployNodeId = '';
    this.deployNodeActiveIndex = 0;
    this.deployNodePickerOpen = true;
    this.scheduleNodeOptionSearch();
  }

  onDeployNodeKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.deployNodePickerOpen = false;
      return;
    }
    const options = this.availableNodes();
    if (!options.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      this.deployNodeActiveIndex = (this.deployNodeActiveIndex + direction + options.length) % options.length;
    } else if (event.key === 'Enter' && this.deployNodePickerOpen && this.deployNodeActiveIndex >= 0) {
      event.preventDefault();
      this.selectDeployNode(options[this.deployNodeActiveIndex]);
    }
  }

  selectDeployNode(node: ManufacturedNode): void {
    this.deployNodeId = node.id;
    this.deployNodeQuery = node.serial_number;
    this.deployNodePickerOpen = false;
    if (this.nodeAddSheetOpen) {
      this.addNodeToManifestDraft();
      this.closeNodeAddSheet();
    }
  }

  async searchRouteOptions(): Promise<void> {
    await this.loadUnitOptions(this.routeSourceRequest()?.site_id);
  }

  routeUnitLabel(index: number): string {
    const id = this.coverageTargets[index]?.pipe_id;
    return id ? this.unitName(id) : '';
  }

  routeSiteLabel(index: number): string {
    const id = this.coverageTargets[index]?.site_id;
    return id ? this.siteName(id) : '';
  }

  openRoutePicker(kind: 'unit' | 'site', index: number): void {
    this.routePickerOpen = { kind, index };
    if (kind === 'unit') {
      this.optionUnitSearch = this.routeUnitQueries[index] ?? '';
      void this.loadUnitOptions(this.routeSourceRequest()?.site_id);
    } else {
      this.optionSiteSearch = this.routeSiteQueries[index] ?? '';
      void this.loadSiteOptions();
    }
  }

  closeRoutePicker(): void {
    setTimeout(() => { this.routePickerOpen = null; }, 120);
  }

  routePickerIsOpen(kind: 'unit' | 'site', index: number): boolean {
    return this.routePickerOpen?.kind === kind && this.routePickerOpen.index === index;
  }

  onRouteUnitQueryChange(index: number, query: string): void {
    this.routeUnitQueries[index] = query;
    this.coverageTargets[index].pipe_id = '';
    this.optionUnitSearch = query;
    this.routePickerOpen = { kind: 'unit', index };
    this.scheduleRouteSearch('unit');
  }

  onRouteSiteQueryChange(index: number, query: string): void {
    this.routeSiteQueries[index] = query;
    this.coverageTargets[index].site_id = '';
    this.optionSiteSearch = query;
    this.routePickerOpen = { kind: 'site', index };
    this.scheduleRouteSearch('site');
  }

  selectRouteUnit(index: number, unit: MonitoringUnit): void {
    this.coverageTargets[index].pipe_id = unit.id;
    this.routeUnitQueries[index] = unit.name;
    this.routePickerOpen = null;
  }

  selectRouteSite(index: number, site: Site): void {
    this.coverageTargets[index].site_id = site.id;
    this.routeSiteQueries[index] = site.name;
    this.routePickerOpen = null;
  }

  scheduleRouteSearch(kind: 'unit' | 'site'): void {
    if (this.routeSearchTimer) clearTimeout(this.routeSearchTimer);
    this.routeSearchTimer = setTimeout(() => {
      this.routeSearchTimer = null;
      void (kind === 'unit' ? this.loadUnitOptions(this.routeSourceRequest()?.site_id) : this.loadSiteOptions());
    }, 220);
  }

  addCoverageTarget(): void {
    const repair = this.routeSourceRequest()?.request_type === 'Request repair';
    this.coverageTargets.push({
      target_kind: 'existing_unit',
      operation: repair ? 'replace_nodes' : 'expand_nodes',
      site_id: this.routeSourceRequest()?.site_id ?? '',
      pipe_id: '',
    });
  }

  removeCoverageTarget(index: number): void {
    if (this.coverageTargets.length <= 1) return;
    this.coverageTargets.splice(index, 1);
    this.routeUnitQueries = Object.fromEntries(this.coverageTargets.map((target, i) => [i, target.pipe_id ? this.unitName(target.pipe_id) : '']));
    this.routeSiteQueries = Object.fromEntries(this.coverageTargets.map((target, i) => [i, target.site_id ? this.siteName(target.site_id) : '']));
  }

  async saveRequestRoute(): Promise<void> {
    const request = this.routeSourceRequest();
    if (!request) return;
    if (request.request_type === 'Request more sensors' || request.request_type === 'Request repair') {
      if (!this.coverageTargets.length) {
        this.error.set('Add at least one coverage target.');
        return;
      }
      if (request.request_type === 'Request more sensors' && !request.site_id) {
        this.error.set('This request has no linked customer site.');
        return;
      }
      if (this.coverageTargets.some((target) =>
        (target.target_kind === 'existing_unit' && !target.pipe_id) ||
        (target.target_kind === 'new_unit' && !target.site_id),
      )) {
        this.error.set('Select every service destination before saving.');
        return;
      }
      await this.runAction(
        () => request.request_type === 'Request repair'
          ? this.api.saveRepairTargets(request.id, this.coverageTargets.map((target) => ({
              pipe_id: target.pipe_id,
            })))
          : this.api.saveMoreCoverageTargets(request.id, this.coverageTargets.map((target) => ({
              target_kind: target.target_kind,
              site_id: target.target_kind === 'new_unit' ? target.site_id : null,
              pipe_id: target.target_kind === 'existing_unit' ? target.pipe_id : null,
            }))),
        request.request_type === 'Request repair' ? 'Repair targets saved.' : 'Coverage targets saved.',
        () => this.closeModal(),
      );
      return;
    }
    if (!this.routeUnitId) {
      this.error.set('Select the existing monitoring unit.');
      return;
    }
    await this.runAction(
      () => this.api.routeServiceRequest({
        p_request_id: request.id,
        p_path: 'repair_existing_unit',
        p_pipe_id: this.routeUnitId,
      }),
      'Service destination saved.',
      () => this.closeModal(),
    );
  }

  openCreateSiteFromRequest(request: ServiceRequest): void {
    this.selectedSiteRequestId = request.id;
    this.siteNameInput = request.location_name;
    this.openModal('create-site');
  }

  openEditSite(site: Site): void {
    this.editingSiteId = site.id;
    this.siteNameInput = site.name;
    this.openModal('edit-site');
  }

  openInviteCustomer(site: Site): void {
    if (!site.ready_monitoring_unit_count || site.customer_email) return;
    this.inviteCustomerSite.set(site);
    this.inviteCustomerName = '';
    this.inviteCustomerEmail = '';
    this.inviteCustomerPhone = '';
    this.inviteCustomerCompany = '';
    this.openModal('invite-customer');
  }

  onInviteCustomerEmailChange(value: string): void {
    this.inviteCustomerEmail = String(value ?? '').toLowerCase().replace(/\s/g, '').slice(0, 254);
  }

  onInviteCustomerPhoneChange(value: string): void {
    let digits = String(value ?? '').replace(/\D/g, '');
    if (digits.startsWith('63')) digits = `0${digits.slice(2)}`;
    else if (digits.startsWith('9')) digits = `0${digits}`;
    digits = digits.slice(0, 11);
    this.inviteCustomerPhone = [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 11)]
      .filter(Boolean)
      .join(' ');
  }

  inviteCustomerFormValid(): boolean {
    const email = this.inviteCustomerEmail.trim();
    const phone = this.inviteCustomerPhone.replace(/\D/g, '');
    return this.inviteCustomerName.trim().length >= 2
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      && /^09\d{9}$/.test(phone);
  }

  async sendCustomerInvitation(): Promise<void> {
    const site = this.inviteCustomerSite();
    if (!site) return;
    if (!this.inviteCustomerFormValid()) {
      this.error.set('Enter a valid customer name, email, and Philippine mobile number.');
      return;
    }
    const email = this.inviteCustomerEmail.trim();
    await this.runAction(
      () => this.api.inviteCustomer({
        siteId: site.id,
        fullName: this.inviteCustomerName.trim(),
        email,
        phone: this.inviteCustomerPhone.replace(/\D/g, ''),
        company: this.inviteCustomerCompany.trim() || null,
      }),
      `Customer invitation sent to ${email}.`,
      () => this.closeModal(),
    );
  }

  siteSourceRequest(): ServiceRequest | null {
    return this.requests().find((request) => request.id === this.selectedSiteRequestId) ?? null;
  }

  openInstallationUnitPlan(request: ServiceRequest): void {
    this.installationUnitPlanRequest.set(request);
    this.nextInstallationUnitPlanKey = 1;
    const targets = this.targetsForRequest(request.id);
    this.installationUnitPlanTargets = targets.length
      ? targets.map((target) => ({
          key: this.nextInstallationUnitPlanKey++,
          name: target.planned_unit_name ?? target.created_pipe_name ?? '',
        }))
      : [{ key: this.nextInstallationUnitPlanKey++, name: '' }];
    this.openModal('installation-unit-plan');
  }

  addInstallationUnitPlanTarget(): void {
    if (this.installationUnitPlanTargets.length >= 64) return;
    this.installationUnitPlanTargets = [
      ...this.installationUnitPlanTargets,
      { key: this.nextInstallationUnitPlanKey++, name: '' },
    ];
  }

  removeInstallationUnitPlanTarget(index: number): void {
    if (this.installationUnitPlanTargets.length <= 1) return;
    this.installationUnitPlanTargets = this.installationUnitPlanTargets
      .filter((_, targetIndex) => targetIndex !== index);
  }

  installationUnitPlanValid(): boolean {
    if (this.installationUnitPlanTargets.length < 1 || this.installationUnitPlanTargets.length > 64) return false;
    const names = this.installationUnitPlanTargets.map((target) => target.name.trim().toLowerCase());
    return names.every((name) => name.length >= 2 && name.length <= 100)
      && new Set(names).size === names.length;
  }

  async saveInstallationUnitPlan(): Promise<void> {
    const request = this.installationUnitPlanRequest();
    if (!request) return;
    if (!this.installationUnitPlanValid()) {
      this.error.set('Name every monitoring unit and use each name only once.');
      return;
    }
    const names = this.installationUnitPlanTargets.map((target) => target.name.trim());
    await this.runAction(
      () => this.api.saveInstallationUnitPlan(request.id, names),
      `${names.length} monitoring unit${names.length === 1 ? '' : 's'} planned and created.`,
      () => this.closeModal(),
    );
  }

  async saveSite(): Promise<void> {
    if (!this.siteNameInput.trim()) {
      this.error.set('Enter the site name.');
      return;
    }
    if (this.modal() === 'create-site') {
      if (!this.selectedSiteRequestId) {
        this.error.set('Select an approved installation request.');
        return;
      }
      await this.runAction(
        () => this.api.createSiteFromRequest(this.selectedSiteRequestId, this.siteNameInput.trim()),
        'Site created from the approved request.',
        () => this.closeModal(),
      );
      return;
    }
    await this.runAction(
      () => this.api.updateSite(this.editingSiteId, this.siteNameInput.trim()),
      'Site updated.',
      () => this.closeModal(),
    );
  }

  openCreateUnit(siteId: string): void {
    this.unitRequestId = '';
    this.unitTargetId = '';
    this.editingUnitId = '';
    this.unitSiteId = siteId;
    this.unitNameInput = 'Main monitoring unit';
    this.unitNodeCountInput = 1;
    this.unitThresholdInput = 2;
    this.openModal('create-unit');
  }

  openCreateUnitForRequest(request: ServiceRequest, targetId = ''): void {
    const target = targetId ? this.requestTargets().find((item) => item.id === targetId) : null;
    const siteId = target?.site_id ?? (request.request_type === 'Request installation'
      ? request.created_site_id
      : request.target_site_id);
    if (!siteId) {
      this.error.set('Choose the destination site first.');
      return;
    }
    this.unitRequestId = target ? '' : request.id;
    this.unitTargetId = target?.id ?? '';
    this.editingUnitId = '';
    this.unitSiteId = siteId;
    this.unitNameInput = 'Main monitoring unit';
    this.unitNodeCountInput = 1;
    this.unitThresholdInput = 2;
    this.openModal('create-unit');
  }

  openEditUnit(unit: MonitoringUnit): void {
    this.unitRequestId = '';
    this.editingUnitId = unit.id;
    this.unitSiteId = unit.site_id;
    this.unitNameInput = unit.name;
    this.unitNodeCountInput = unit.expected_node_count;
    this.unitThresholdInput = unit.alert_threshold_deg;
    this.openModal('edit-unit');
  }

  async saveUnit(): Promise<void> {
    if (!this.unitSiteId || !this.unitNameInput.trim()) {
      this.error.set('Enter the monitoring unit name.');
      return;
    }
    if (this.modal() === 'edit-unit' && this.unitNodeCountInput < 1) {
      this.error.set('Planned node count must be at least 1.');
      return;
    }
    if (!Number.isFinite(this.unitThresholdInput) || this.unitThresholdInput < 0.1 || this.unitThresholdInput > 45) {
      this.error.set('Alert threshold must be between 0.1 and 45 degrees.');
      return;
    }
    if (this.modal() === 'create-unit') {
      await this.runAction(
        async () => {
          if (this.unitTargetId) {
            const unitId = await this.api.createMonitoringUnitFromTarget(this.unitTargetId, this.unitNameInput.trim());
            await this.api.updateMonitoringUnitThreshold(unitId, this.unitThresholdInput);
          } else if (this.unitRequestId) {
            const unitId = await this.api.createMonitoringUnitFromRequest(this.unitRequestId, this.unitNameInput.trim());
            await this.api.updateMonitoringUnitThreshold(unitId, this.unitThresholdInput);
          } else {
            await this.api.createMonitoringUnit({
              site_id: this.unitSiteId,
              name: this.unitNameInput.trim(),
              expected_node_count: this.unitNodeCountInput,
              alert_threshold_deg: this.unitThresholdInput,
            });
          }
        },
        'Monitoring unit created.',
        () => this.closeModal(),
      );
      return;
    }
    await this.runAction(
      () => this.api.updateMonitoringUnit(this.editingUnitId, {
        name: this.unitNameInput.trim(),
        expected_node_count: this.unitNodeCountInput,
        alert_threshold_deg: this.unitThresholdInput,
      }),
      'Monitoring unit updated.',
      () => this.closeModal(),
    );
  }

  openCreateNode(): void {
    this.nodeMacInput = '';
    this.openModal('create-node');
  }

  formatMacInput(value: string): void {
    const hex = value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
    this.nodeMacInput = hex.match(/.{1,2}/g)?.join(':') ?? '';
  }

  formatMacInputEvent(event: Event): void {
    const input = event.target as HTMLInputElement;
    const caret = input.selectionStart ?? input.value.length;
    const hexBeforeCaret = input.value.slice(0, caret).replace(/[^0-9A-F]/gi, '');
    this.formatMacInput(input.value);
    input.value = this.nodeMacInput;
    const nextCaret = this.formatMacInputValue(hexBeforeCaret).length;
    queueMicrotask(() => input.setSelectionRange(nextCaret, nextCaret));
  }

  private formatMacInputValue(value: string): string {
    const hex = value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
    return hex.match(/.{1,2}/g)?.join(':') ?? '';
  }

  async saveNode(): Promise<void> {
    const mac = this.nodeMacInput.trim().toUpperCase();
    if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(mac)) {
      this.error.set('Enter the MAC address in AA:BB:CC:DD:EE:FF format.');
      return;
    }
    await this.runAction(
      () => this.api.registerNode({ mac_addr: mac }),
      'Manufactured node registered.',
      () => this.closeModal(),
    );
  }

  openDeployNode(unitId = ''): void {
    this.deployTargetId = '';
    this.deployNodeId = '';
    this.deployNodeQuery = '';
    this.deployNodePickerOpen = false;
    this.deployUnitId = unitId;
    this.deployPosition = unitId ? (this.unitById(unitId)?.max_position ?? 0) + 1 : 1;
    this.optionNodeSearch = '';
    void this.loadAvailableNodeOptions();
    void this.loadUnitOptions();
    this.openModal('deploy-node');
  }

  async deployNode(): Promise<void> {
    if (!this.deployNodeId || !this.deployUnitId || this.deployPosition < 1) {
      this.error.set('Select a node and monitoring unit, then enter its physical position.');
      return;
    }
    const unit = this.unitById(this.deployUnitId);
    if (!unit) {
      this.error.set('Select a valid monitoring unit.');
      return;
    }
    const activeUnit = unit.deployment_status === 'ready';
    await this.runAction(
      () => this.deployTargetId
        ? this.api.addNodeToServiceTarget({
            p_target_id: this.deployTargetId,
            p_registry_id: this.deployNodeId,
            p_position: this.deployPosition,
          })
        : activeUnit
          ? this.api.addNodeToActiveUnit({
              p_registry_id: this.deployNodeId,
              p_pipe_id: this.deployUnitId,
              p_position: this.deployPosition,
            })
          : this.api.deployNode({
            p_registry_id: this.deployNodeId,
            p_pipe_id: this.deployUnitId,
            p_position: this.deployPosition,
            p_is_gateway: this.deployPosition === 1,
          }),
      this.deployTargetId
        ? 'Node added to this coverage target.'
        : activeUnit ? 'Node added to the active monitoring unit.' : 'Node added to the deployment manifest',
      () => this.closeModal(),
    );
  }

  openServiceTargetPlan(target: ServiceRequestTarget): void {
    if (target.target_kind !== 'existing_unit' || target.operation !== 'expand_nodes') return;
    this.serviceTargetPlan.set(target);
    this.serviceTargetNodeCountInput = Math.max(1, target.requested_node_count, target.added_node_count);
    this.openModal('service-target-plan');
  }

  async saveServiceTargetPlan(): Promise<void> {
    const target = this.serviceTargetPlan();
    if (!target) return;
    if (!Number.isInteger(this.serviceTargetNodeCountInput) || this.serviceTargetNodeCountInput < 1 || this.serviceTargetNodeCountInput > 64) {
      this.error.set('Enter a whole number between 1 and 64.');
      return;
    }
    await this.runAction(
      () => this.api.planServiceTarget(target.id, this.serviceTargetNodeCountInput),
      'Coverage plan saved.',
      () => this.closeModal(),
    );
  }

  async completeServiceTarget(target: ServiceRequestTarget): Promise<void> {
    await this.runAction(
      () => this.api.completeServiceTarget(target.id),
      `Repair finished for ${target.pipe_name || this.unitName(target.pipe_id)}.`,
    );
  }

  openDeployNodeForTarget(target: ServiceRequestTarget): void {
    if (!target.pipe_id) return;
    this.deployTargetId = target.id;
    this.deployNodeId = '';
    this.deployNodeQuery = '';
    this.deployNodePickerOpen = false;
    this.deployUnitId = target.pipe_id;
    this.deployPosition = (this.unitById(target.pipe_id)?.max_position ?? 0) + 1;
    this.optionNodeSearch = '';
    void this.loadAvailableNodeOptions();
    void this.loadUnitOptions();
    this.openModal('deploy-node');
  }

  isAddingToActiveUnit(): boolean {
    return this.unitById(this.deployUnitId)?.deployment_status === 'ready';
  }

  async completeServiceRequest(request: ServiceRequest): Promise<void> {
    await this.runAction(
      () => this.api.completeServiceRequest(request.id),
      'Service request marked complete.',
    );
  }

  openReplaceNode(unitId: string): void {
    this.replacementTargetId = '';
    this.prepareReplacement(unitId);
  }

  async replaceNode(): Promise<void> {
    if (!this.replacementUnitId || !this.replacementSensorNodeId || !this.replacementRegistryId) {
      this.error.set('Select the broken node and its replacement.');
      return;
    }
    await this.runAction(
      () => this.replacementTargetId
        ? this.api.replaceNodeForTarget({
            p_target_id: this.replacementTargetId,
            p_sensor_node_id: this.replacementSensorNodeId,
            p_replacement_registry_id: this.replacementRegistryId,
          })
        : this.api.replaceNode({
            p_pipe_id: this.replacementUnitId,
            p_sensor_node_id: this.replacementSensorNodeId,
            p_replacement_registry_id: this.replacementRegistryId,
          }),
      'Node replaced. Historical sensor readings were preserved.',
      () => this.closeModal(),
    );
  }

  openReplaceNodeForTarget(target: ServiceRequestTarget): void {
    if (!target.pipe_id) return;
    this.replacementTargetId = target.id;
    this.prepareReplacement(target.pipe_id);
  }

  private prepareReplacement(unitId: string): void {
    this.replacementUnitId = unitId;
    this.replacementSensorNodeId = '';
    this.replacementRegistryId = '';
    this.replacementNodeQuery = '';
    this.replacementNodePickerOpen = false;
    this.optionNodeSearch = '';
    this.replacementUnitNodes.set([]);
    this.replacementNodeOptions.set([]);
    void this.loadReplacementUnitNodes(unitId);
    void this.searchReplacementNodes();
    this.openModal('replace-node');
  }

  private async loadReplacementUnitNodes(unitId: string): Promise<void> {
    const revision = ++this.replacementUnitLoadRevision;
    const startedAt = performance.now();
    this.replacementUnitNodesLoading.set(true);
    try {
      const nodes = await this.api.listNodesForUnit(unitId);
      await this.holdPlaceholder(startedAt);
      if (revision !== this.replacementUnitLoadRevision || unitId !== this.replacementUnitId) return;
      this.replacementUnitNodes.set(nodes);
    } finally {
      if (revision === this.replacementUnitLoadRevision) this.replacementUnitNodesLoading.set(false);
    }
  }

  async searchReplacementNodes(): Promise<void> {
    const revision = ++this.replacementNodeLoadRevision;
    const query = this.replacementNodeQuery.trim();
    if (query.length < 2) {
      this.replacementNodeOptions.set([]);
      this.replacementNodeOptionsLoading.set(false);
      return;
    }
    const startedAt = performance.now();
    this.replacementNodeOptionsLoading.set(true);
    try {
      const results = await this.api.searchAvailableNodes(this.replacementNodeQuery);
      await this.holdPlaceholder(startedAt);
      if (revision !== this.replacementNodeLoadRevision) return;
      this.replacementNodeOptions.set(this.mergePickerOptions(results, this.replacementNodeOptions(), new Set([this.replacementRegistryId].filter(Boolean))));
    } finally {
      if (revision === this.replacementNodeLoadRevision) this.replacementNodeOptionsLoading.set(false);
    }
  }

  openReplacementNodePicker(): void {
    this.replacementNodePickerOpen = true;
    if (!this.replacementNodeOptions().length) void this.searchReplacementNodes();
  }

  selectReplacementNode(node: ManufacturedNode): void {
    this.replacementRegistryId = node.id;
    this.replacementNodeQuery = node.serial_number;
    this.replacementNodePickerOpen = false;
  }

  closeReplacementNodePicker(): void {
    setTimeout(() => { this.replacementNodePickerOpen = false; }, 120);
  }

  onReplacementNodeQueryChange(query: string): void {
    this.replacementNodeQuery = query;
    this.replacementRegistryId = '';
    this.replacementNodePickerOpen = true;
    this.optionNodeSearch = query;
    this.scheduleNodeOptionSearch(true);
  }

  scheduleNodeOptionSearch(forReplacement = false): void {
    if (this.pickerSearchTimer) clearTimeout(this.pickerSearchTimer);
    this.pickerSearchTimer = setTimeout(() => {
      this.pickerSearchTimer = null;
      void (forReplacement ? this.searchReplacementNodes() : this.loadAvailableNodeOptions());
    }, 220);
  }

  openManifest(unit: MonitoringUnit): void {
    const revision = ++this.manifestLoadRevision;
    const startedAt = performance.now();
    this.manifestUnit.set(unit);
    this.manifestNodes.set([]);
    this.manifestLoading.set(true);
    this.openModal('manifest');
    void this.api.listNodesForUnit(unit.id)
      .then(async (nodes) => {
        await this.holdPlaceholder(startedAt);
        if (revision === this.manifestLoadRevision && this.manifestUnit()?.id === unit.id) this.manifestNodes.set(nodes);
      })
      .catch((error) => this.error.set(this.message(error)))
      .finally(() => {
        if (revision === this.manifestLoadRevision) this.manifestLoading.set(false);
      });
  }

  openHardwareSetup(unit: MonitoringUnit): void {
    const revision = ++this.manifestLoadRevision;
    const startedAt = performance.now();
    this.manifestUnit.set(unit);
    this.manifestNodes.set([]);
    this.manifestDraft = [];
    this.nodeAddSheetOpen = false;
    this.unitNodeCountInput = Math.max(1, unit.expected_node_count);
    this.deployNodeId = '';
    this.deployNodeQuery = '';
    this.deployNodePickerOpen = false;
    this.deployNodeActiveIndex = -1;
    this.deployPosition = 1;
    this.manifestLoading.set(true);
    this.openModal('hardware-setup');
    void this.api.listNodesForUnit(unit.id)
      .then(async (nodes) => {
        await this.holdPlaceholder(startedAt);
        if (revision !== this.manifestLoadRevision || this.manifestUnit()?.id !== unit.id) return;
        this.manifestNodes.set(nodes);
        this.manifestDraft = nodes.map((node) => ({
          registry_id: node.id,
          position: node.position_in_pipe ?? 1,
        })).sort((a, b) => a.position - b.position || a.registry_id.localeCompare(b.registry_id));
        this.normalizeManifestOrder();
        this.unitNodeCountInput = Math.max(this.unitNodeCountInput, this.manifestDraft.length);
        this.availableNodeOptions.set([]);
      })
      .catch((error) => this.error.set(this.message(error)))
      .finally(() => {
        if (revision === this.manifestLoadRevision) this.manifestLoading.set(false);
      });
  }

  manifestNodeLabel(registryId: string): string {
    const node = this.manifestNodes().find((item) => item.id === registryId);
    return node ? `${node.serial_number}|${node.mac_addr}` : 'Unavailable node';
  }

  moveManifestNode(registryId: string, direction: -1 | 1): void {
    const currentIndex = this.manifestDraft.findIndex((node) => node.registry_id === registryId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= this.manifestDraft.length) return;
    const [node] = this.manifestDraft.splice(currentIndex, 1);
    this.manifestDraft.splice(targetIndex, 0, node);
    this.normalizeManifestOrder();
  }

  openNodeAddSheet(): void {
    this.deployNodeId = '';
    this.deployNodeQuery = '';
    this.deployNodePickerOpen = true;
    this.nodeAddSheetOpen = true;
    this.deployNodeActiveIndex = this.availableNodeOptions().length ? 0 : -1;
    if (!this.availableNodeOptions().length) void this.loadAvailableNodeOptions();
  }

  closeNodeAddSheet(): void {
    this.nodeAddSheetOpen = false;
    this.deployNodePickerOpen = false;
    this.deployNodeId = '';
    this.deployNodeQuery = '';
  }

  focusHardwareTarget(event: Event): void {
    requestAnimationFrame(() => (event.target as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  setHardwareTarget(requestedTarget: number | null): void {
    if (requestedTarget === null || !Number.isInteger(requestedTarget)) return;
    const minimumTarget = Math.max(1, this.manifestDraft.length);
    this.unitNodeCountInput = Math.max(minimumTarget, Math.min(64, requestedTarget));
  }

  changeHardwareTarget(delta: number): void {
    this.setHardwareTarget(this.unitNodeCountInput + delta);
  }

  addNodeToManifestDraft(): void {
    const node = this.availableNodeOptions().find((item) => item.id === this.deployNodeId);
    if (!node) {
      this.error.set('Choose an available node to add.');
      return;
    }
    if (this.manifestDraft.length >= this.unitNodeCountInput) {
      this.error.set('Increase the target node count before adding another node.');
      return;
    }
    if (this.manifestDraft.some((item) => item.registry_id === node.id)) {
      this.error.set('This node is already in the hardware plan.');
      return;
    }
    this.manifestDraft.push({ registry_id: node.id, position: this.manifestDraft.length + 1 });
    this.normalizeManifestOrder();
    this.manifestNodes.update((nodes) => nodes.some((item) => item.id === node.id) ? nodes : [...nodes, node]);
    this.availableNodeOptions.update((nodes) => nodes.filter((item) => item.id !== node.id));
    this.deployNodeId = '';
    this.deployNodeQuery = '';
    this.deployNodePickerOpen = false;
  }

  removeManifestNode(index: number): void {
    const [removed] = this.manifestDraft.splice(index, 1);
    if (!removed) return;
    const node = this.manifestNodes().find((item) => item.id === removed.registry_id);
    if (node) {
      this.availableNodeOptions.update((nodes) => nodes.some((item) => item.id === node.id) ? nodes : [...nodes, node]);
    }
    this.normalizeManifestOrder();
  }

  hardwareSetupIssue(): string {
    if (!Number.isInteger(this.unitNodeCountInput) || this.unitNodeCountInput < 1 || this.unitNodeCountInput > 64) return 'Target must be a whole number between 1 and 64.';
    if (this.unitNodeCountInput < this.manifestDraft.length) return `Target cannot be lower than ${this.manifestDraft.length} assigned nodes.`;
    if (this.manifestDraft.some((node, index) => node.position !== index + 1)) return `Chain order must remain contiguous from 1 to ${this.manifestDraft.length}.`;
    return '';
  }

  async saveHardwareSetup(): Promise<void> {
    const unit = this.manifestUnit();
    if (!unit) return;
    const issue = this.hardwareSetupIssue();
    if (issue) {
      this.error.set(issue);
      return;
    }
    await this.runAction(
      () => this.api.saveInstallationHardwareSetup({
        p_pipe_id: unit.id,
        p_expected_node_count: this.unitNodeCountInput,
        p_manifest: this.manifestDraft,
      }),
      'Installation hardware setup saved.',
      () => this.closeModal(),
    );
  }

  private normalizeManifestOrder(): void {
    this.manifestDraft.forEach((node, index) => { node.position = index + 1; });
  }


  async markInstallationReady(unit: MonitoringUnit): Promise<void> {
    await this.runAction(
      () => this.api.advanceDeployment({
        p_pipe_id: unit.id,
        p_action: 'mark_installation_ready',
      }),
      'Deployment is ready for installation.',
    );
  }

  async startCommissioning(unit: MonitoringUnit): Promise<void> {
    await this.runAction(
      () => this.api.advanceDeployment({
        p_pipe_id: unit.id,
        p_action: 'start_commissioning',
      }),
      'Commissioning started.',
      () => this.openCommissioning(unit),
    );
  }

  openCommissioning(unit: MonitoringUnit): void {
    this.commissioningUnitId = unit.id;
    this.commissioningNotesInput = unit.commissioning_notes ?? '';
    this.hardwareMountedCheck = unit.hardware_mounted_check;
    this.rs485Check = unit.rs485_check;
    this.gatewayOnlineCheck = unit.gateway_online_check;
    this.readingsReceivedCheck = unit.readings_received_check;
    this.baselineCapturedCheck = unit.baseline_captured_check;
    this.openModal('commissioning');
  }

  async saveCommissioning(complete: boolean): Promise<void> {
    await this.runAction(
      () => this.api.advanceDeployment({
        p_pipe_id: this.commissioningUnitId,
        p_action: complete ? 'complete_commissioning' : 'save_commissioning',
        p_notes: this.commissioningNotesInput.trim() || null,
        p_hardware_mounted: this.hardwareMountedCheck,
        p_rs485: this.rs485Check,
        p_gateway_online: this.gatewayOnlineCheck,
        p_readings_received: this.readingsReceivedCheck,
        p_baseline_captured: this.baselineCapturedCheck,
      }),
      complete ? 'Monitoring is now active.' : 'Commissioning progress saved.',
      () => this.closeModal(),
    );
  }


  allCommissioningChecksComplete(): boolean {
    return this.hardwareMountedCheck &&
      this.rs485Check &&
      this.gatewayOnlineCheck &&
      this.readingsReceivedCheck &&
      this.baselineCapturedCheck;
  }

  unitHasGateway(unit: MonitoringUnit): boolean {
    return unit.gateway_count === 1;
  }

  manifestReady(unit: MonitoringUnit): boolean {
    return unit.plan_confirmed &&
      unit.node_count === unit.expected_node_count &&
      unit.gateway_count === 1;
  }

  toggleOverflowMenu(event: MouseEvent, kind: OverflowKind, id: string): void {
    event.stopPropagation();
    const trigger = event.currentTarget as HTMLButtonElement;
    const current = this.overflowMenu();
    if (current?.kind === kind && current.id === id) {
      this.closeOverflowMenu();
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const width = 190;
    const estimatedHeight = kind === 'site' ? 58 : 104;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const below = rect.bottom + 6;
    const top = below + estimatedHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - estimatedHeight - 6);

    this.overflowTrigger = trigger;
    this.overflowMenu.set({ kind, id, left, top });
    queueMicrotask(() => document.querySelector<HTMLElement>('.floating-overflow-menu')?.focus());
  }

  closeOverflowMenu(restoreFocus = true): void {
    if (!this.overflowMenu()) return;
    this.overflowMenu.set(null);
    if (restoreFocus) queueMicrotask(() => this.overflowTrigger?.focus());
    this.overflowTrigger = null;
  }

  menuIsOpen(kind: OverflowKind, id: string): boolean {
    const menu = this.overflowMenu();
    return menu?.kind === kind && menu.id === id;
  }

  confirmDelete(kind: DeleteKind, id: string, label: string): void {
    this.closeOverflowMenu(false);
    const warnings: Record<DeleteKind, string> = {
      request: 'This permanently removes the request from the admin queue.',
      site: 'Only a site with no monitoring units can be deleted.',
      unit: 'Only a monitoring unit with no assigned nodes can be deleted.',
      node: 'Only an unassigned and undeployed manufactured node can be deleted.',
    };
    this.deleteTarget.set({ kind, id, label, warning: warnings[kind] });
    this.openModal('delete');
  }

  async deleteConfirmed(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;
    const actions: Record<DeleteKind, () => Promise<void>> = {
      request: () => this.api.deleteServiceRequest(target.id),
      site: () => this.api.deleteSite(target.id),
      unit: () => this.api.deleteMonitoringUnit(target.id),
      node: () => this.api.deleteAvailableNode(target.id),
    };
    await this.runAction(actions[target.kind], `${this.deleteKindLabel(target.kind)} deleted.`, () => this.closeModal());
  }

  canDeleteRequest(request: ServiceRequest): boolean {
    return !['approved', 'closed'].includes(request.status)
      && !request.created_site_id
      && !request.created_pipe_id
      && !request.fulfillment_path
      && this.targetsForRequest(request.id).length === 0;
  }

  canDeleteSite(site: Site): boolean {
    return this.unitCount(site.id) === 0;
  }

  canDeleteUnit(unit: MonitoringUnit): boolean {
    return (unit.node_count ?? 0) === 0;
  }

  canDeleteNode(node: ManufacturedNode): boolean {
    return node.status === 'manufactured' && !node.assigned_site_id && !node.assigned_pipe_id && !node.deployed_node_id;
  }

  closeFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget && !this.loading()) this.closeModal();
  }

  trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const panel = event.currentTarget as HTMLElement;
    const controls = Array.from(
      panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'),
    );
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  dismissFeedback(): void {
    this.clearFeedback();
  }

  closeModal(): void {
    if (this.pickerSearchTimer) clearTimeout(this.pickerSearchTimer);
    if (this.routeSearchTimer) clearTimeout(this.routeSearchTimer);
    this.pickerSearchTimer = null;
    this.routeSearchTimer = null;
    this.routePickerOpen = null;
    this.nodeAddSheetOpen = false;
    this.modal.set(null);
    document.body.classList.remove('modal-open');
    this.deleteTarget.set(null);
    this.intakeReviewTarget.set(null);
    this.inviteCustomerSite.set(null);
    this.closeRequestTarget.set(null);
    this.installationUnitPlanRequest.set(null);
    this.serviceTargetPlan.set(null);
    this.intakeReviewReason = '';
    this.inviteCustomerName = '';
    this.inviteCustomerEmail = '';
    this.inviteCustomerPhone = '';
    this.inviteCustomerCompany = '';
    this.closeRequestReason = '';
    this.error.set('');
  }

  private resetViewState(view: View): void {
    if (view === 'requests') {
      this.requestWorkspaceMode = 'intake';
      this.intakeFilter = 'pending';
      this.intakeSearch = '';
      this.intakePage.set(1);
      this.selectedIntakeId.set(null);
      this.requestFilter.set('needs-action');
      this.requestTypeFilter = 'all';
      this.requestSearch = '';
      this.requestPage.set(1);
      this.selectedRequestId.set(null);
    }
    if (view === 'sites') {
      this.siteSearch = '';
      this.sitePage.set(1);
    }
    if (view === 'inventory') {
      this.nodeSearch = '';
      this.nodeFilter = 'all';
      this.nodeAssignmentFilter = 'all';
      this.nodePage.set(1);
    }
    if (view === 'deployments') {
      this.unitSearch = '';
      this.unitFilter = 'all';
      this.unitPage.set(1);
    }
  }

  siteName(id: string | null): string {
    if (!id) return 'Unassigned';
    return [...this.sites(), ...this.siteOptions()].find((site) => site.id === id)?.name
      ?? this.requestTargets().find((target) => target.site_id === id)?.site_name
      ?? 'Unknown site';
  }

  unitName(id: string | null): string {
    if (!id) return 'Unassigned';
    return this.unitById(id)?.name
      ?? this.requestTargets().find((target) => target.pipe_id === id)?.pipe_name
      ?? 'Unknown unit';
  }

  unitById(id: string | null): MonitoringUnit | undefined {
    return id ? [...this.units(), ...this.unitOptions()].find((unit) => unit.id === id) : undefined;
  }

  unitCount(siteId: string): number {
    return this.sites().find((site) => site.id === siteId)?.monitoring_unit_count ?? 0;
  }

  unitNodes(unitId: string): ManufacturedNode[] {
    return this.nodes()
      .filter((node) => node.assigned_pipe_id === unitId)
      .sort((a, b) => (a.position_in_pipe ?? 999) - (b.position_in_pipe ?? 999));
  }

  requestStageLabel(status: string, closureType?: ServiceRequest['closure_type']): string {
    if (status === 'closed' && closureType === 'cancelled') return 'Cancelled';
    return ({
      submitted: 'New request',
      under_review: 'Contact needed',
      clarification_needed: 'Clarifying details',
      proposal_ready: 'Proposal sent',
      changes_requested: 'Changes requested',
      approved: 'Approved',
      closed: 'Not proceeding',
    } as Record<string, string>)[status] ?? this.formatStatus(status);
  }

  requestCloseActionLabel(request: ServiceRequest): CloseRequestTarget['actionLabel'] | null {
    if (request.status === 'closed' || request.service_status === 'completed') return null;
    if (request.status !== 'approved') return 'Not proceeding';

    const targets = this.targetsForRequest(request.id);
    const createdStages = [
      request.created_pipe_status,
      ...targets.map((target) => target.created_pipe_status),
    ].filter(Boolean);
    const started = createdStages.some((stage) => ['installation', 'commissioning', 'ready'].includes(stage ?? ''))
      || targets.some((target) => target.added_node_count > 0);
    if (started) return 'Stop remaining work';

    const hasWork = Boolean(
      request.created_site_id
      || request.created_pipe_id
      || request.fulfillment_path
      || targets.length,
    );
    return hasWork ? 'Cancel work' : 'Cancel request';
  }

  requestTypeLabel(type: string): string {
    return ({
      'Request installation': 'New installation',
      'Request repair': 'Repair or service',
      'Request more sensors': 'More coverage',
    } as Record<string, string>)[type] ?? type;
  }

  installationPlanNeeded(request: ServiceRequest): boolean {
    if (request.request_type !== 'Request installation' || !request.created_site_id) return false;
    const targets = this.targetsForRequest(request.id);
    if (!targets.length) return !request.created_pipe_id;
    return targets.some((target) => !target.planned_unit_name || !target.created_pipe_id);
  }

  requestNextStep(request: ServiceRequest): string {
    if (request.status === 'submitted') return 'Start review.';
    if (request.status === 'under_review') return 'Send proposal or request details.';
    if (request.status === 'clarification_needed') return 'Send proposal.';
    if (request.status === 'proposal_ready') return 'Record customer response.';
    if (request.status === 'changes_requested') return 'Send revision.';
    if (request.status === 'closed') return request.closure_type === 'cancelled' ? 'No further work.' : 'Closed.';
    if (request.service_status === 'completed') return 'Work completed.';

    if (request.request_type === 'Request installation' && !request.created_site_id) return 'Create site.';
    if (this.installationPlanNeeded(request)) return 'Name and plan monitoring units.';
    if (request.request_type === 'Request installation' && request.fulfillment_path === 'multi_unit_service') {
      const targets = this.targetsForRequest(request.id);
      if (targets.some((target) => !target.created_pipe_id)) return 'Create next unit.';
      if (targets.some((target) => !this.unitIsActive(target.created_pipe_id))) return 'Set up the planned units.';
      return 'Complete installation.';
    }
    if (request.request_type !== 'Request installation' && !request.fulfillment_path) {
      if (request.request_type === 'Request repair') return 'Select monitoring units.';
      if (request.request_type === 'Request more sensors' && request.site_id) return 'Plan coverage targets.';
      return 'Select destination.';
    }
    if (request.fulfillment_path === 'multi_unit_service') {
      const targets = this.targetsForRequest(request.id);
      if (targets.some((target) => target.target_kind === 'new_unit' && !target.created_pipe_id)) return 'Create next unit.';
      if (targets.some((target) => target.target_kind === 'new_unit' && !this.unitIsActive(target.created_pipe_id))) return 'Finish new installations.';
      if (targets.some((target) => target.target_kind === 'existing_unit' && target.operation === 'expand_nodes' && !target.work_plan_confirmed)) return 'Plan coverage.';
      if (targets.some((target) => target.target_kind === 'existing_unit' && target.operation === 'expand_nodes' && !this.serviceTargetComplete(target))) return 'Install planned hardware.';
      if (targets.some((target) => target.target_kind === 'existing_unit' && target.operation === 'replace_nodes' && !target.completed_at && target.added_node_count > 0)) return 'Finish repair or replace another node.';
      if (targets.some((target) => target.target_kind === 'existing_unit' && target.operation === 'replace_nodes' && !target.completed_at)) return 'Replace a broken node.';
      return 'Complete request.';
    }
    if (request.fulfillment_path === 'repair_existing_unit') return 'Replace node or complete service.';
    if (request.fulfillment_path === 'expand_existing_unit') return 'Add requested nodes.';
    if (!request.created_pipe_id) return 'Create unit.';

    const status = request.created_pipe_status ?? this.unitById(request.created_pipe_id)?.deployment_status;
    if (!status) return 'Unit unavailable.';
    if (status === 'ready') return 'Monitoring active.';
    if (status === 'commissioning') return 'Finish field checks.';
    if (status === 'installation') return 'Start field checks.';
    return 'Finish hardware setup.';
  }

  requestNeedsDeliveryAction(request: ServiceRequest): boolean {
    if (request.needs_action !== undefined) return request.needs_action;
    if (request.service_status === 'completed') return false;
    if (request.request_type === 'Request installation') {
      if (!request.created_site_id) return true;
      const targets = this.targetsForRequest(request.id);
      if (!targets.length) return !request.created_pipe_id || this.unitById(request.created_pipe_id)?.deployment_status !== 'ready';
      return targets.some((target) => !this.serviceTargetComplete(target));
    }
    return !request.fulfillment_path;
  }

  requestHasUnit(request: ServiceRequest): boolean {
    return Boolean(request.created_pipe_id ?? request.target_pipe_id);
  }

  requestMonitoringActive(request: ServiceRequest): boolean {
    return (request.created_pipe_status ?? this.unitById(request.created_pipe_id)?.deployment_status) === 'ready';
  }

  deliveryStage(request: ServiceRequest): string | null {
    if (request.status === 'closed' && request.closure_type === 'cancelled') return 'Cancelled';
    if (request.status !== 'approved') return null;
    if (request.request_type !== 'Request installation' && !request.fulfillment_path) return 'Route needed';
    if (request.service_status === 'completed') return 'Complete';
    if (request.fulfillment_path === 'multi_unit_service') return 'Multiple targets';
    if (request.fulfillment_path === 'repair_existing_unit') return 'Repair';
    if (request.fulfillment_path === 'expand_existing_unit') return 'Coverage';
    if (request.request_type === 'Request installation' && !request.created_site_id) return 'Create site';
    if (!request.created_pipe_id) return 'Create unit';
    const status = request.created_pipe_status ?? this.unitById(request.created_pipe_id)?.deployment_status;
    if (!status) return 'Unavailable';
    if (status === 'commissioning') return 'Field checks';
    if (status === 'installation') return 'Field-ready';
    if (status === 'ready') return 'Active';
    return 'Planning';
  }

  requestTargetLabel(request: ServiceRequest): string | null {
    if (request.fulfillment_path === 'multi_unit_service') {
      const count = this.targetsForRequest(request.id).length;
      if (!count) return null;
      const noun = request.request_type === 'Request installation'
        ? 'installation unit'
        : request.request_type === 'Request repair' ? 'repair target' : 'coverage target';
      return `${count} ${noun}${count === 1 ? '' : 's'}`;
    }
    if (request.target_pipe_id) {
      return `${request.target_pipe_name ?? this.unitName(request.target_pipe_id)} · ${request.target_site_name ?? this.siteName(request.target_site_id)}`;
    }
    if (request.target_site_id) return request.target_site_name ?? this.siteName(request.target_site_id);
    return null;
  }

  targetsForRequest(requestId: string): ServiceRequestTarget[] {
    return this.requestTargets().filter((target) => target.service_request_id === requestId);
  }

  unitIsActive(unitId: string | null): boolean {
    if (!unitId) return false;
    const unit = this.unitById(unitId);
    if (unit) return unit.deployment_status === 'ready';
    return this.requestTargets().some((target) => target.created_pipe_id === unitId && target.created_pipe_status === 'ready');
  }

  requestCompletionLabel(request: ServiceRequest): string {
    if (request.request_type === 'Request repair') return 'Complete repair';
    if (request.request_type === 'Request more sensors') return 'Complete coverage';
    return 'Complete request';
  }

  pendingCoverageTargetForUnit(unit: MonitoringUnit): ServiceRequestTarget | null {
    return [...this.installationTargets(), ...this.requestTargets()].find((target) =>
      target.target_kind === 'existing_unit'
      && target.operation === 'expand_nodes'
      && target.pipe_id === unit.id
      && !target.completed_at
      && target.added_node_count < target.requested_node_count
      && target.work_plan_confirmed,
    ) ?? null;
  }

  serviceTargetComplete(target: ServiceRequestTarget): boolean {
    if (target.target_kind === 'new_unit') {
      return Boolean(target.created_pipe_id && this.unitIsActive(target.created_pipe_id));
    }
    if (target.operation === 'replace_nodes') return Boolean(target.completed_at);
    return target.work_plan_confirmed && target.added_node_count >= target.requested_node_count;
  }

  coverageTargetsComplete(request: ServiceRequest): boolean {
    const targets = this.targetsForRequest(request.id);
    return targets.length > 0 && targets.every((target) => this.serviceTargetComplete(target));
  }

  selectRequestSite(request: ServiceRequest): void {
    if (!request.created_site_id && !request.target_site_id) return;
    this.siteSearch = request.created_site_name ?? request.target_site_name ?? '';
    this.sitePage.set(1);
    this.selectView('sites');
    void this.loadSitesPage();
  }

  formatStatus(value: string): string {
    return value.replaceAll('_', ' ');
  }

  pickerEmptyMessage(query: string | null | undefined): string {
    return (query ?? '').trim() ? 'Type one more character' : 'Type to search';
  }

  statusTone(value: string): 'neutral' | 'attention' | 'healthy' | 'negative' {
    if (['accepted', 'approved', 'ready', 'deployed'].includes(value)) return 'healthy';
    if (['closed', 'rejected', 'spam', 'retired', 'not_proceeding'].includes(value)) return 'negative';
    if (['submitted', 'clarification_needed', 'changes_requested', 'installation'].includes(value)) {
      return 'attention';
    }
    return 'neutral';
  }

  private ensureSelectedIntake(): void {
    const current = this.selectedIntake();
    if (!current || !this.intakes().some((intake) => intake.id === current.id)) {
      this.selectedIntakeId.set(this.intakes()[0]?.id ?? null);
    }
  }

  private ensureSelectedRequest(): void {
    const current = this.selectedRequest();
    if (!current || !this.filteredRequests().some((request) => request.id === current.id)) {
      this.selectedRequestId.set(this.filteredRequests()[0]?.id ?? null);
    }
  }

  private async startRequestListener(): Promise<void> {
    this.stopListeningForRequests();
    try {
      this.stopRequestListener = await this.api.subscribeToServiceRequests(
        () => this.scheduleRequestRefresh(),
        (status) => this.requestRealtimeStatus.set(status),
      );
    } catch (error) {
      this.requestRealtimeStatus.set('offline');
      this.error.set(this.message(error));
    }
  }

  private scheduleRequestRefresh(): void {
    if (this.requestRefreshTimer) clearTimeout(this.requestRefreshTimer);
    this.requestRefreshTimer = setTimeout(() => {
      this.requestRefreshTimer = null;
      void this.refreshRequests();
    }, 120);
  }

  private async refreshRequests(): Promise<void> {
    try {
      await Promise.all([this.loadIntakesPage(), this.loadRequestsPage()]);
    } catch (error) {
      this.error.set(this.message(error));
    }
  }

  private stopListeningForRequests(): void {
    this.stopRequestListener?.();
    this.stopRequestListener = null;
    if (this.requestRefreshTimer) clearTimeout(this.requestRefreshTimer);
    this.requestRefreshTimer = null;
    this.requestRealtimeStatus.set('offline');
  }

  private mergePickerOptions<T extends { id: string }>(results: T[], current: T[], selected: Set<string>): T[] {
    const merged = [...results, ...current.filter((item) => selected.has(item.id))];
    return merged.filter((item, index) => merged.findIndex((candidate) => candidate.id === item.id) === index);
  }

  private async holdPlaceholder(startedAt: number): Promise<void> {
    const remaining = this.minimumPlaceholderMs - (performance.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  private scheduleCollectionSearch(search: () => void): void {
    if (this.collectionSearchTimer) clearTimeout(this.collectionSearchTimer);
    this.collectionSearchTimer = setTimeout(() => {
      this.collectionSearchTimer = null;
      search();
    }, 280);
  }

  private openModal(kind: ModalKind): void {
    this.closeOverflowMenu(false);
    this.clearMessages();
    this.modal.set(kind);
    document.body.classList.add('modal-open');
  }

  private deleteKindLabel(kind: DeleteKind): string {
    return ({ request: 'Service request', site: 'Site', unit: 'Monitoring unit', node: 'Node' })[kind];
  }

  private async runAction(
    action: () => Promise<void>,
    successMessage: string,
    afterSuccess?: () => void,
  ): Promise<void> {
    this.clearMessages();
    this.loading.set(true);
    try {
      await action();
      afterSuccess?.();
      this.notice.set(successMessage);
      await this.loadAll();
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.loading.set(false);
    }
  }

  private clearFeedback(): void {
    this.notice.set('');
    this.error.set('');
  }

  private clearMessages(): void {
    this.clearFeedback();
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }
}
