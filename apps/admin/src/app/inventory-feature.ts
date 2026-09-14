import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { App } from './app';
import { AppSelect } from './app-select';

@Component({
  selector: 'app-inventory-feature',
  imports: [CommonModule, FormsModule, AppSelect],
  template: `
    @let vm = app();
    <section class="section-block">
      <div class="collection-toolbar" role="search">
        <label class="search-field"><span class="sr-only">Search nodes</span><input type="search" name="nodeSearch" [ngModel]="vm.nodeSearch" (ngModelChange)="vm.onNodeSearchChange($event)" placeholder="Search serial or MAC" /></label>
        <app-select class="filter-select" ariaLabel="Filter node state" [value]="vm.nodeFilter" [options]="vm.nodeFilterOptions" (valueChange)="vm.setNodeFilter($event)" />
        <app-select class="filter-select" ariaLabel="Filter node assignment" [value]="vm.nodeAssignmentFilter" [options]="vm.nodeAssignmentOptions" (valueChange)="vm.setNodeAssignmentFilter($event)" />
        <button class="primary-button compact-button" type="button" (click)="vm.openCreateNode()">Register node</button>
      </div>

      @if (vm.nodesLoading()) {
        <div class="table-wrap table-skeleton" aria-label="Loading nodes"><span class="skeleton-table-head"></span><span></span><span></span><span></span><span></span><span></span></div>
      } @else if (!vm.nodes().length) {
        <div class="table-wrap empty-table-state"><div class="empty-state"><h3>No matching nodes</h3></div></div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Serial number</th><th>MAC address</th><th>Assignment</th><th>State</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              @for (node of vm.nodes(); track node.id) {
                <tr>
                  <td><strong class="mono">{{ node.serial_number }}</strong></td>
                  <td class="mono">{{ node.mac_addr }}</td>
                  <td>{{ node.assigned_pipe_id ? (node.site_name || 'Unknown site') + ' · ' + (node.pipe_name || 'Unknown unit') : 'Unassigned' }}</td>
                  <td><span class="status" [attr.data-tone]="vm.statusTone(node.status)">{{ node.status }}</span></td>
                  <td><button class="overflow-trigger" type="button" aria-label="More node actions" title="More actions" [attr.aria-expanded]="vm.menuIsOpen('node', node.id)" (click)="vm.toggleOverflowMenu($event, 'node', node.id)">...</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <footer class="collection-pagination" [class.loading-hidden]="vm.nodesLoading()"><span>{{ vm.pageStart(vm.nodePage(), vm.nodePageSize, vm.nodeTotal()) }} to {{ vm.pageEnd(vm.nodePage(), vm.nodePageSize, vm.nodeTotal()) }} of {{ vm.nodeTotal() }}</span><div><button type="button" [disabled]="vm.nodePage() === 1" (click)="vm.changeNodePage(-1)">Previous</button><span>Page {{ vm.nodePage() }} of {{ vm.pageCount(vm.nodeTotal(), vm.nodePageSize) }}</span><button type="button" [disabled]="vm.nodePage() >= vm.pageCount(vm.nodeTotal(), vm.nodePageSize)" (click)="vm.changeNodePage(1)">Next</button></div></footer>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryFeature {
  readonly app = input.required<App>();
}
