import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core';
import { IonButton } from '@ionic/angular/ion-button';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { CustomerAlert, CustomerApi } from './customer-api.service';

@Component({
  imports: [CommonModule, IonButton, IonContent, IonHeader, IonTitle, IonToolbar],
  template: `
    <ion-header class="app-header"><ion-toolbar><ion-title>Alerts</ion-title></ion-toolbar></ion-header>
    <ion-content><main class="page-content">
      <header class="page-intro"><div><p>Site events</p><h1>Alert history</h1></div></header>
      @if (loading()) {
        <section class="list-skeleton" aria-label="Loading alerts"><span></span><span></span><span></span><span></span></section>
      } @else if (error()) {
        <section class="state-card"><h2>Alerts unavailable</h2><p>{{ error() }}</p><ion-button size="small" (click)="load()">Try again</ion-button></section>
      } @else {
        <section class="alert-list">
          @for (alert of alerts(); track alert.id) {
            <article class="alert-row" [attr.data-severity]="alert.severity">
              <span class="severity-bar"></span>
              <div class="alert-main"><header><strong>{{ alert.severity === 'critical' ? 'Critical movement' : 'Movement warning' }}</strong><time>{{ alert.ts | date: 'MMM d, h:mm a' }}</time></header><p>{{ location(alert) }}</p><small>{{ alert.value === null ? 'Threshold event' : (alert.value | number: '1.2-2') + '° tilt' }}</small></div>
              @if (alert.acknowledged_at) {<span class="acknowledged">Seen</span>} @else {<ion-button fill="outline" size="small" [disabled]="acknowledging() === alert.id" (click)="acknowledge(alert)">Acknowledge</ion-button>}
            </article>
          } @empty {
            <div class="state-card fixed-footprint"><h2>No alerts</h2><p>New warning events will appear here.</p></div>
          }
        </section>
      }
    </main></ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertsPage implements OnDestroy {
  readonly alerts = signal<CustomerAlert[]>([]);
  readonly loading = signal(true);
  readonly acknowledging = signal<string | null>(null);
  readonly error = signal('');
  private stopRealtime: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly api: CustomerApi) { void this.load(); }

  ngOnDestroy(): void {
    this.stopRealtime?.();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.alerts.set(await this.api.alerts());
      if (!this.stopRealtime) this.stopRealtime = await this.api.subscribe(() => this.scheduleRefresh());
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Alerts could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  async acknowledge(alert: CustomerAlert): Promise<void> {
    this.acknowledging.set(alert.id);
    this.error.set('');
    try {
      await this.api.acknowledgeAlert(alert.id);
      this.alerts.update((items) => items.map((item) => item.id === alert.id ? { ...item, acknowledged_at: new Date().toISOString() } : item));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Alert could not be acknowledged.');
    } finally {
      this.acknowledging.set(null);
    }
  }

  location(alert: CustomerAlert): string {
    const unit = alert.sensors?.sensor_nodes?.pipes?.name ?? 'Monitoring unit';
    const position = alert.sensors?.sensor_nodes?.position_in_pipe;
    const sensor = alert.sensors?.label;
    return [unit, position ? `Node ${position}` : '', sensor].filter(Boolean).join(' · ');
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      this.refreshTimer = null;
      try { this.alerts.set(await this.api.alerts()); } catch { /* Keep visible data and retry on the next event. */ }
    }, 500);
  }
}
