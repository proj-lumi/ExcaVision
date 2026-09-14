import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { App } from './app';
import { AppSelect } from './app-select';

@Component({
  selector: 'app-installations-feature',
  imports: [CommonModule, FormsModule, AppSelect],
  template: `
    @let vm = app();
    <section class="section-block">
      <div class="collection-toolbar" role="search">
        <label class="search-field"><span class="sr-only">Search installations</span><input type="search" name="unitSearch" [ngModel]="vm.unitSearch" (ngModelChange)="vm.onUnitSearchChange($event)" placeholder="Search unit or site" /></label>
        <app-select class="filter-select" ariaLabel="Filter installations" [value]="vm.unitFilter" [options]="vm.unitFilterOptions" (valueChange)="vm.setUnitFilter($event)" />
      </div>

      @if (vm.unitsLoading()) {
        <div class="installation-scroll"><div class="installation-groups collection-card-skeleton deployment-skeleton" aria-label="Loading installations"><span></span><span></span><span></span></div></div>
      } @else if (!vm.units().length) {
        <div class="installation-scroll empty-installation-state"><div class="empty-state"><h3>No installations</h3></div></div>
      } @else {
        <div class="installation-scroll"><div class="installation-groups">
          @for (group of vm.installationGroups(); track group.id) {
            <section class="installation-group">
              <header><h3>{{ group.title }}</h3><span>{{ group.units.length }}</span></header>
              <div class="deployment-list">
                @for (unit of group.units; track unit.id) {
                  <article class="deployment-record">
                    <header><div><p>{{ unit.site_name || 'Unknown site' }}</p><h3>{{ unit.name }}</h3></div></header>
                    @if (unit.plan_confirmed) {
                      <div class="manifest-summary">
                        <div><span>Planned</span><strong>{{ unit.expected_node_count }}</strong></div>
                        <div><span>Assigned</span><strong>{{ unit.node_count ?? 0 }}</strong></div>
                        <div><span>Gateway</span><strong>{{ vm.unitHasGateway(unit) ? 'Ready' : 'Missing' }}</strong></div>
                      </div>
                      @if ((unit.node_count ?? 0) > 0 && unit.deployment_status !== 'planning') {<button class="text-button manifest-link" type="button" (click)="vm.openManifest(unit)">Assigned nodes</button>}
                    }
                    <div class="deployment-actions">
                      @if (vm.pendingCoverageTargetForUnit(unit); as target) {
                        <button class="primary-button" type="button" (click)="vm.openDeployNodeForTarget(target)">Add planned node</button>
                      }
                      @if (unit.deployment_status === 'planning') {
                        <button [class]="vm.manifestReady(unit) ? 'secondary-button' : 'primary-button'" type="button" (click)="vm.openHardwareSetup(unit)">{{ unit.plan_confirmed ? (vm.manifestReady(unit) ? 'Review hardware' : 'Continue setup') : 'Set up hardware' }}</button>
                        @if (vm.manifestReady(unit)) {<button class="primary-button" type="button" (click)="vm.markInstallationReady(unit)">Mark field-ready</button>}
                      } @else if (unit.deployment_status === 'installation') {
                        <button class="primary-button" type="button" (click)="vm.startCommissioning(unit)">Start checks</button>
                      } @else if (unit.deployment_status === 'commissioning') {
                        <button class="primary-button" type="button" (click)="vm.openCommissioning(unit)">Continue checks</button>
                      }
                    </div>
                  </article>
                }
              </div>
            </section>
          }
        </div></div>
      }
      <footer class="collection-pagination" [class.loading-hidden]="vm.unitsLoading()"><span>{{ vm.pageStart(vm.unitPage(), vm.unitPageSize, vm.unitTotal()) }} to {{ vm.pageEnd(vm.unitPage(), vm.unitPageSize, vm.unitTotal()) }} of {{ vm.unitTotal() }}</span><div><button type="button" [disabled]="vm.unitPage() === 1" (click)="vm.changeUnitPage(-1)">Previous</button><span>Page {{ vm.unitPage() }} of {{ vm.pageCount(vm.unitTotal(), vm.unitPageSize) }}</span><button type="button" [disabled]="vm.unitPage() >= vm.pageCount(vm.unitTotal(), vm.unitPageSize)" (click)="vm.changeUnitPage(1)">Next</button></div></footer>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallationsFeature {
  readonly app = input.required<App>();
}
