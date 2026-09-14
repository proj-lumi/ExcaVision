import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { App } from './app';
import { AppSelect } from './app-select';

@Component({
  selector: 'app-requests-feature',
  imports: [CommonModule, FormsModule, AppSelect],
  template: `
    @let vm = app();
    <section class="request-workspace">
      <nav class="request-queue-tabs" role="tablist" aria-label="Request workflow">
        <button type="button" role="tab" [attr.aria-selected]="vm.requestWorkspaceMode === 'intake'" [class.active]="vm.requestWorkspaceMode === 'intake'" (click)="vm.setRequestWorkspaceMode('intake')">Intake review</button>
        <button type="button" role="tab" [attr.aria-selected]="vm.requestWorkspaceMode === 'work'" [class.active]="vm.requestWorkspaceMode === 'work'" (click)="vm.setRequestWorkspaceMode('work')">Work queue</button>
      </nav>
      @if (vm.requestWorkspaceMode === 'intake') {
        <div class="request-toolbar intake-toolbar" aria-label="Intake search and filters">
          <div class="collection-search" role="search"><label class="search-field"><span class="sr-only">Search installation intake</span><input type="search" name="intakeSearch" [ngModel]="vm.intakeSearch" (ngModelChange)="vm.onIntakeSearchChange($event)" placeholder="Search site, customer, or email" /></label></div>
          <app-select class="request-stage-filter" ariaLabel="Intake status" [value]="vm.intakeFilter" [options]="vm.intakeFilterOptions" (valueChange)="vm.setIntakeFilter($event)" />
        </div>
        <aside class="request-inbox" aria-label="Installation intake inbox">
          <header><h2>Intake</h2><span>{{ vm.intakeTotal() }}</span></header>
          <div class="request-list">
            @if (vm.intakesLoading()) {<div class="request-list-skeleton" aria-label="Loading installation intake"><span></span><span></span><span></span><span></span></div>}
            @else {
              @for (intake of vm.intakes(); track intake.id) {
                <button type="button" [class.selected]="vm.selectedIntakeId() === intake.id" (click)="vm.selectIntake(intake)">
                  <span class="request-list-top"><strong>{{ intake.location_name }}</strong><span><time>{{ intake.created_at | date: 'MMM d' }}</time></span></span>
                  <span class="request-list-type">New installation</span><span>{{ intake.name }}</span>
                  <small class="status request-status" [attr.data-tone]="vm.statusTone(intake.status)">{{ vm.formatStatus(intake.status) }}</small>
                </button>
              } @empty {<div class="inbox-empty"><p>No intake in this view.</p></div>}
            }
          </div>
          <footer class="list-pagination" [class.loading-hidden]="vm.intakesLoading()"><span>{{ vm.pageStart(vm.intakePage(), vm.intakePageSize, vm.intakeTotal()) }} to {{ vm.pageEnd(vm.intakePage(), vm.intakePageSize, vm.intakeTotal()) }} of {{ vm.intakeTotal() }}</span><div><button type="button" [disabled]="vm.intakePage() === 1" (click)="vm.changeIntakePage(-1)">Previous</button><span>Page {{ vm.intakePage() }} of {{ vm.pageCount(vm.intakeTotal(), vm.intakePageSize) }}</span><button type="button" [disabled]="vm.intakePage() >= vm.pageCount(vm.intakeTotal(), vm.intakePageSize)" (click)="vm.changeIntakePage(1)">Next</button></div></footer>
        </aside>
        <article class="request-detail">
          @if (vm.intakesLoading()) {<div class="request-detail-skeleton" aria-label="Loading intake details"><span class="skeleton-line medium"></span><span class="skeleton-line long"></span><span class="skeleton-detail-band"></span><span class="skeleton-detail-card"></span><span class="skeleton-detail-row"></span></div>}
          @else if (vm.selectedIntake(); as intake) {
            <header class="request-detail-header"><div><p class="request-type-label">Installation intake</p><h2>{{ intake.location_name }}</h2><span>{{ intake.created_at | date: 'MMM d, y · h:mm a' }}</span></div></header>
            <div class="stage-grid"><div><span>Review</span><strong>{{ vm.formatStatus(intake.status) }}</strong></div></div>
            @if (intake.status === 'pending') {
              <section class="next-action-panel"><div><span>Next</span><h3>Verify the contact and site.</h3></div><div class="context-actions"><button class="primary-button" type="button" (click)="vm.acceptIntake(intake)">Accept into work queue</button><button class="secondary-button" type="button" (click)="vm.openIntakeReview(intake, 'rejected')">Reject</button><button class="danger-button" type="button" (click)="vm.openIntakeReview(intake, 'spam')">Mark spam</button></div></section>
            } @else if (intake.review_reason) {<section class="request-detail-section closure-summary"><h3>Review reason</h3><p>{{ intake.review_reason }}</p></section>}
            <section class="request-detail-section"><h3>Contact</h3><p>{{ intake.name }}@if (intake.company) {, {{ intake.company }}}</p><div class="contact-actions"><a class="secondary-button" [href]="'mailto:' + intake.email">{{ intake.email }}</a><a class="secondary-button" [href]="'tel:' + intake.phone">{{ intake.phone }}</a></div></section>
            <section class="request-detail-section location-section"><div><h3>Location</h3><p>{{ intake.location_label || 'Approximate pin' }}</p></div><a class="secondary-button" [href]="intake.google_maps_url || intake.osm_url" target="_blank" rel="noreferrer">Open map</a>@if (intake.location_notes) {<div class="request-notes"><span>Customer notes</span><p>{{ intake.location_notes }}</p></div>}</section>
          } @else {<div class="detail-empty"><h2>Select an intake record</h2></div>}
        </article>
      } @else {
        <div class="request-toolbar" aria-label="Request search and filters">
          <div class="collection-search" role="search"><label class="search-field"><span class="sr-only">Search requests by location, customer, company, or email</span><input type="search" name="requestSearch" [ngModel]="vm.requestSearch" (ngModelChange)="vm.onRequestSearchChange($event)" placeholder="Search requests" /></label></div>
          <app-select class="inbox-type-filter" ariaLabel="Request type" [value]="vm.requestTypeFilter" [options]="vm.requestTypeOptions" (valueChange)="vm.setRequestTypeFilter($event)" />
          <app-select class="request-stage-filter" ariaLabel="Request stage" [value]="vm.requestFilter()" [options]="vm.requestFilterOptions" (valueChange)="vm.setRequestFilter($event)" />
        </div>
        <aside class="request-inbox" aria-label="Service request inbox">
          <header><h2>Queue</h2><span>{{ vm.requestTotal() }}</span></header>
          <div class="request-list">
            @if (vm.requestsLoading()) {<div class="request-list-skeleton" aria-label="Loading requests"><span></span><span></span><span></span><span></span></div>}
            @else {
              @for (request of vm.filteredRequests(); track request.id) {
                <button type="button" [class.selected]="vm.selectedRequestId() === request.id" (click)="vm.selectRequest(request)"><span class="request-list-top"><strong>{{ request.location_name }}</strong><span><time>{{ request.created_at | date: 'MMM d' }}</time></span></span><span class="request-list-type">{{ vm.requestTypeLabel(request.request_type) }}</span><span>{{ request.name }}</span><small class="status request-status" [attr.data-tone]="vm.statusTone(request.status)">{{ vm.requestStageLabel(request.status, request.closure_type) }}</small></button>
              } @empty {<div class="inbox-empty"><p>No requests in this view.</p></div>}
            }
          </div>
          <footer class="list-pagination" [class.loading-hidden]="vm.requestsLoading()"><span>{{ vm.pageStart(vm.requestPage(), vm.requestPageSize, vm.requestTotal()) }} to {{ vm.pageEnd(vm.requestPage(), vm.requestPageSize, vm.requestTotal()) }} of {{ vm.requestTotal() }}</span><div><button type="button" [disabled]="vm.requestPage() === 1" (click)="vm.changeRequestPage(-1)">Previous</button><span>Page {{ vm.requestPage() }} of {{ vm.pageCount(vm.requestTotal(), vm.requestPageSize) }}</span><button type="button" [disabled]="vm.requestPage() >= vm.pageCount(vm.requestTotal(), vm.requestPageSize)" (click)="vm.changeRequestPage(1)">Next</button></div></footer>
        </aside>
        <article class="request-detail">
          @if (vm.requestsLoading()) {<div class="request-detail-skeleton" aria-label="Loading request details"><span class="skeleton-line medium"></span><span class="skeleton-line long"></span><span class="skeleton-detail-band"></span><span class="skeleton-detail-card"></span><span class="skeleton-detail-row"></span><span class="skeleton-detail-row"></span></div>}
          @else if (vm.selectedRequest(); as request) {
            <header class="request-detail-header"><div><p class="request-type-label">{{ vm.requestTypeLabel(request.request_type) }}</p><h2>{{ request.location_name }}</h2><span>{{ request.created_at | date: 'MMM d, y · h:mm a' }}</span></div><button class="overflow-trigger" type="button" aria-label="More request actions" title="More actions" [attr.aria-expanded]="vm.menuIsOpen('request', request.id)" (click)="vm.toggleOverflowMenu($event, 'request', request.id)">...</button></header>
            <div class="stage-grid"><div><span>Request</span><strong>{{ vm.requestStageLabel(request.status, request.closure_type) }}</strong></div>@if (vm.deliveryStage(request); as stage) {<div><span>Work</span><strong>{{ stage }}</strong></div>}@if (vm.requestTargetLabel(request); as target) {<div><span>Destination</span><strong>{{ target }}</strong></div>}</div>
            <section class="next-action-panel">
              <div><span>Next</span><h3>{{ vm.requestNextStep(request) }}</h3></div>
              <div class="context-actions">
                @switch (request.status) {
                  @case ('submitted') {<button class="primary-button" type="button" (click)="vm.changeRequestStatus(request, 'under_review')">Start review</button>}
                  @case ('under_review') {<button class="primary-button" type="button" (click)="vm.changeRequestStatus(request, 'proposal_ready')">Proposal sent</button><button class="secondary-button" type="button" (click)="vm.changeRequestStatus(request, 'clarification_needed')">Request details</button>}
                  @case ('clarification_needed') {<button class="primary-button" type="button" (click)="vm.changeRequestStatus(request, 'proposal_ready')">Proposal sent</button>}
                  @case ('proposal_ready') {<button class="primary-button" type="button" (click)="vm.changeRequestStatus(request, 'approved')">Approved</button><button class="secondary-button" type="button" (click)="vm.changeRequestStatus(request, 'changes_requested')">Changes requested</button>}
                  @case ('changes_requested') {<button class="primary-button" type="button" (click)="vm.changeRequestStatus(request, 'proposal_ready')">Revision sent</button>}
                  @case ('approved') {
                    @if (request.service_status === 'completed') {
                      <button class="secondary-button" type="button" (click)="vm.selectRequestSite(request)">{{ request.request_type === 'Request installation' ? 'View site' : 'View destination' }}</button>
                    } @else {
                    @if (request.request_type === 'Request installation') {
                      @if (!request.created_site_id) {<button class="primary-button" type="button" (click)="vm.openCreateSiteFromRequest(request)">Create site</button>}
                      @else if (vm.installationPlanNeeded(request)) {<button class="primary-button" type="button" (click)="vm.openInstallationUnitPlan(request)">Name monitoring units</button>}
                      @else if (request.fulfillment_path === 'multi_unit_service') {
                        @for (target of vm.targetsForRequest(request.id); track target.id) {
                          @if (target.target_kind === 'new_unit' && !vm.unitIsActive(target.created_pipe_id)) {<button class="secondary-button" type="button" (click)="vm.openTargetInstallation(target)">{{ target.created_pipe_status === 'planning' ? 'Set up' : 'Continue' }} {{ target.created_pipe_name || target.planned_unit_name }}</button>}
                        }
                        @if (vm.coverageTargetsComplete(request)) {<button class="primary-button" type="button" (click)="vm.completeServiceRequest(request)">Complete installation</button>}
                      } @else if (!vm.requestHasUnit(request)) {<button class="primary-button" type="button" (click)="vm.openCreateUnitForRequest(request)">Add unit</button>}
                      @else if (vm.requestMonitoringActive(request)) {<button class="secondary-button" type="button" (click)="vm.selectRequestSite(request)">View site</button>}
                      @else {<button class="primary-button" type="button" (click)="vm.openRequestInstallation(request)">Continue installation</button><button class="secondary-button" type="button" (click)="vm.selectRequestSite(request)">View site</button>}
                    } @else if (!request.fulfillment_path) {<button class="primary-button" type="button" (click)="vm.openRouteRequest(request)">{{ request.request_type === 'Request repair' ? 'Select monitoring units' : request.request_type === 'Request more sensors' && request.site_id ? 'Plan coverage targets' : 'Select destination' }}</button>}
                    @else if (request.fulfillment_path === 'multi_unit_service') {
                      @for (target of vm.targetsForRequest(request.id); track target.id) {
                        @if (target.target_kind === 'new_unit' && !target.created_pipe_id) {<button class="primary-button" type="button" (click)="vm.openCreateUnitForRequest(request, target.id)">Create unit at {{ target.site_name || vm.siteName(target.site_id) }}</button>}
                        @else if (target.target_kind === 'new_unit' && !vm.unitIsActive(target.created_pipe_id)) {<button class="primary-button" type="button" (click)="vm.openTargetInstallation(target)">Continue installation at {{ target.site_name || vm.siteName(target.site_id) }}</button>}
                        @else if (target.target_kind === 'existing_unit' && target.operation === 'replace_nodes' && !target.completed_at) {<button class="primary-button" type="button" (click)="vm.openReplaceNodeForTarget(target)">Replace node in {{ vm.unitName(target.pipe_id) }}</button>@if (target.added_node_count > 0) {<button class="secondary-button" type="button" (click)="vm.completeServiceTarget(target)">Finish repair at {{ vm.unitName(target.pipe_id) }}</button>}}
                        @else if (target.target_kind === 'existing_unit' && target.operation === 'expand_nodes' && !target.work_plan_confirmed) {<button class="primary-button" type="button" (click)="vm.openServiceTargetPlan(target)">Plan coverage for {{ vm.unitName(target.pipe_id) }}</button>}
                        @else if (target.target_kind === 'existing_unit' && target.operation === 'expand_nodes' && !vm.serviceTargetComplete(target)) {<button class="primary-button" type="button" (click)="vm.openDeployNodeForTarget(target)">Add node to {{ vm.unitName(target.pipe_id) }}</button>}
                      }
                      @if (vm.coverageTargetsComplete(request)) {<button class="secondary-button" type="button" (click)="vm.completeServiceRequest(request)">{{ vm.requestCompletionLabel(request) }}</button>}
                    } @else if (request.fulfillment_path === 'expand_existing_unit') {<button class="primary-button" type="button" (click)="vm.openDeployNode(request.target_pipe_id ?? '')">Add node</button><button class="secondary-button" type="button" (click)="vm.completeServiceRequest(request)">Complete service</button>}
                    @else if (request.fulfillment_path === 'repair_existing_unit') {<button class="primary-button" type="button" (click)="vm.openReplaceNode(request.target_pipe_id ?? '')">Replace node</button><button class="secondary-button" type="button" (click)="vm.completeServiceRequest(request)">Complete service</button>}
                    @else if (request.fulfillment_path === 'new_unit_existing_site' && !vm.requestHasUnit(request)) {<button class="primary-button" type="button" (click)="vm.openCreateUnitForRequest(request)">Add unit</button><button class="secondary-button" type="button" (click)="vm.openRouteRequest(request)">Change destination</button>}
                    @else if (request.fulfillment_path === 'new_unit_existing_site' && !vm.requestMonitoringActive(request)) {<button class="primary-button" type="button" (click)="vm.openRequestInstallation(request)">Continue installation</button><button class="secondary-button" type="button" (click)="vm.selectRequestSite(request)">View site</button>}
                    @else {<button class="primary-button" type="button" (click)="vm.selectRequestSite(request)">View destination</button><button class="secondary-button" type="button" (click)="vm.openRouteRequest(request)">Change destination</button>}
                    }
                  }
                }
              </div>
            </section>
            @if (request.status === 'closed' && request.closure_reason) {<section class="request-detail-section closure-summary"><h3>Reason</h3><p>{{ request.closure_reason }}</p></section>}
            <section class="request-detail-section"><h3>Contact</h3><p>{{ request.name }}@if (request.company) {, {{ request.company }}}</p><div class="contact-actions"><a class="secondary-button" [href]="'mailto:' + request.email">Email</a><a class="secondary-button" [href]="'tel:' + request.phone">{{ request.phone }}</a></div></section>
            <section class="request-detail-section location-section"><div><h3>Location</h3><p>{{ request.location_label || 'Approximate pin' }}</p></div><a class="secondary-button" [href]="request.google_maps_url || request.osm_url" target="_blank" rel="noreferrer">Open map</a>@if (request.location_notes) {<div class="request-notes"><span>Customer notes</span><p>{{ request.location_notes }}</p></div>}</section>
          } @else {<div class="detail-empty"><h2>Select a request</h2></div>}
        </article>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestsFeature {
  readonly app = input.required<App>();
}
