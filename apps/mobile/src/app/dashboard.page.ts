import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonButton } from '@ionic/angular/ion-button';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonRefresher } from '@ionic/angular/ion-refresher';
import { IonRefresherContent } from '@ionic/angular/ion-refresher-content';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { AuthService } from './auth.service';
import { CustomerApi, CustomerProfile, CustomerSite, Reading, UnitSummary } from './customer-api.service';

@Component({
  imports: [CommonModule, IonButton, IonContent, IonHeader, IonRefresher, IonRefresherContent, IonTitle, IonToolbar],
  template: `
    <ion-header class="app-header"><ion-toolbar><ion-title><span class="header-brand">ExcaVision</span></ion-title><ion-button slot="end" fill="clear" size="small" (click)="signOut()">Sign out</ion-button></ion-toolbar></ion-header>
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content pullingText="Pull to refresh" /></ion-refresher>
      <main class="page-content">
        @if (loading()) {
          <section class="dashboard-skeleton" aria-label="Loading site monitoring"><span class="skeleton-title"></span><span class="skeleton-card"></span><span class="skeleton-card"></span></section>
        } @else if (error()) {
          <section class="state-card"><h1>Monitoring unavailable</h1><p>{{ error() }}</p><ion-button size="small" (click)="load()">Try again</ion-button></section>
        } @else if (site(); as currentSite) {
          <header class="page-intro"><div><p>Monitoring site</p><h1>{{ currentSite.name }}</h1></div><span class="connection-state" [attr.data-live]="realtimeStatus() === 'live'">{{ realtimeStatus() === 'live' ? 'Live' : 'Updating' }}</span></header>
          <section class="unit-grid" aria-label="Monitoring units">
            @for (unit of units(); track unit.id) {
              <article class="unit-card">
                <header><div><p>Monitoring unit</p><h2>{{ unit.name }}</h2></div><span class="status-chip">{{ unit.deployment_status === 'ready' ? 'Active' : unit.deployment_status }}</span></header>
                <div class="unit-reading">
                  <span>Worst current tilt</span>
                  <strong>{{ worstTilt(unit) === null ? 'No data' : (worstTilt(unit) | number: '1.2-2') + '°' }}</strong>
                  @if (thresholdEditingUnitId() === unit.id) {
                    <div class="threshold-editor">
                      <label>Alert threshold (degrees)<input type="number" min="0.1" max="45" step="0.1" [value]="thresholdInput()" (input)="setThresholdInput($event)" inputmode="decimal" /></label>
                      <small>Range: 0.1–45°. This applies only to {{ unit.name }}.</small>
                      <div><button type="button" class="text-button" (click)="cancelThresholdEdit()">Cancel</button><button type="button" class="primary-mini-button" [disabled]="thresholdSaving()" (click)="saveThreshold(unit)">{{ thresholdSaving() ? 'Saving…' : 'Save threshold' }}</button></div>
                      @if (thresholdError()) {<p class="form-error">{{ thresholdError() }}</p>}
                    </div>
                  } @else {
                    <small>Alert threshold {{ unit.alert_threshold_deg | number: '1.1-1' }}° <button type="button" class="text-button" (click)="beginThresholdEdit(unit)">Edit</button></small>
                  }
                </div>
                <footer><span>{{ sensorCount(unit) }} sensors</span><span [class.stale]="isStale(unit)">{{ latestTime(unit) ? (isStale(unit) ? 'Stale · ' : 'Updated · ') + (latestTime(unit) | date: 'shortTime') : 'Waiting for readings' }}</span></footer>
              </article>
            } @empty {
              <article class="state-card fixed-footprint"><h2>No monitoring units</h2><p>Commissioned units will appear here.</p></article>
            }
          </section>
        }
      </main>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage implements OnDestroy {
  readonly profile = signal<CustomerProfile | null>(null);
  readonly site = signal<CustomerSite | null>(null);
  readonly units = signal<UnitSummary[]>([]);
  readonly readings = signal<Reading[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly realtimeStatus = signal<'connecting' | 'live' | 'offline'>('connecting');
  readonly thresholdEditingUnitId = signal<string | null>(null);
  readonly thresholdInput = signal('');
  readonly thresholdSaving = signal(false);
  readonly thresholdError = signal('');
  private stopRealtime: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly api: CustomerApi, private readonly auth: AuthService, private readonly router: Router) {
    void this.load();
  }

  ngOnDestroy(): void {
    this.stopRealtime?.();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const profile = await this.api.profile();
      const [site, units] = await Promise.all([this.api.site(profile.site_id), this.api.units(profile.site_id)]);
      const readings = await this.api.recentReadings(this.sensorIds(units));
      this.profile.set(profile);
      this.site.set(site);
      this.units.set(units);
      this.readings.set(this.latestPerSensor(readings));
      if (!this.stopRealtime) {
        this.stopRealtime = await this.api.subscribe(() => this.scheduleLiveRefresh());
        this.realtimeStatus.set('live');
      }
    } catch (error) {
      this.realtimeStatus.set('offline');
      this.error.set(error instanceof Error ? error.message : 'Monitoring could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(event: CustomEvent): Promise<void> {
    await this.load();
    await (event.target as unknown as { complete: () => Promise<void> }).complete();
  }

  beginThresholdEdit(unit: UnitSummary): void {
    this.thresholdEditingUnitId.set(unit.id);
    this.thresholdInput.set(unit.alert_threshold_deg.toFixed(1));
    this.thresholdError.set('');
  }

  setThresholdInput(event: Event): void {
    this.thresholdInput.set((event.target as HTMLInputElement).value);
  }

  cancelThresholdEdit(): void {
    this.thresholdEditingUnitId.set(null);
    this.thresholdError.set('');
  }

  async saveThreshold(unit: UnitSummary): Promise<void> {
    const value = Number(this.thresholdInput());
    if (!Number.isFinite(value) || value < 0.1 || value > 45) {
      this.thresholdError.set('Enter a value between 0.1 and 45 degrees.');
      return;
    }
    this.thresholdSaving.set(true);
    this.thresholdError.set('');
    try {
      await this.api.updateUnitThreshold(unit.id, value);
      this.units.update((units) => units.map((item) => item.id === unit.id ? { ...item, alert_threshold_deg: Math.round(value * 10) / 10 } : item));
      this.thresholdEditingUnitId.set(null);
    } catch (error) {
      this.thresholdError.set(error instanceof Error ? error.message : 'Threshold could not be saved.');
    } finally {
      this.thresholdSaving.set(false);
    }
  }

  sensorCount(unit: UnitSummary): number {
    return unit.sensor_nodes.reduce((count, node) => count + node.sensors.length, 0);
  }

  worstTilt(unit: UnitSummary): number | null {
    const ids = new Set(this.sensorIds([unit]));
    const values = this.readings().filter((reading) => ids.has(reading.sensor_id)).map((reading) => Math.abs(reading.tilt));
    return values.length ? Math.max(...values) : null;
  }

  latestTime(unit: UnitSummary): Date | null {
    const ids = new Set(this.sensorIds([unit]));
    const timestamps = this.readings().filter((reading) => ids.has(reading.sensor_id)).map((reading) => new Date(reading.ts).getTime());
    return timestamps.length ? new Date(Math.max(...timestamps)) : null;
  }

  isStale(unit: UnitSummary): boolean {
    const latest = this.latestTime(unit);
    return !latest || Date.now() - latest.getTime() > 5 * 60 * 1000;
  }

  signOut(): void {
    this.auth.signOut();
    void this.router.navigateByUrl('/login');
  }

  private scheduleLiveRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      this.refreshTimer = null;
      try {
        this.readings.set(this.latestPerSensor(await this.api.recentReadings(this.sensorIds(this.units()))));
        this.realtimeStatus.set('live');
      } catch {
        this.realtimeStatus.set('offline');
      }
    }, 800);
  }

  private sensorIds(units: UnitSummary[]): string[] {
    return units.flatMap((unit) => unit.sensor_nodes.flatMap((node) => node.sensors.map((sensor) => sensor.id)));
  }

  private latestPerSensor(readings: Reading[]): Reading[] {
    const seen = new Set<string>();
    return readings.filter((reading) => {
      if (seen.has(reading.sensor_id)) return false;
      seen.add(reading.sensor_id);
      return true;
    });
  }
}
