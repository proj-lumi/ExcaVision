import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton } from '@ionic/angular/ion-button';
import { IonContent } from '@ionic/angular/ion-content';
import { IonHeader } from '@ionic/angular/ion-header';
import { IonTextarea } from '@ionic/angular/ion-textarea';
import { IonTitle } from '@ionic/angular/ion-title';
import { IonToolbar } from '@ionic/angular/ion-toolbar';
import { CustomerApi, CustomerRequest } from './customer-api.service';

@Component({
  imports: [CommonModule, FormsModule, IonButton, IonContent, IonHeader, IonTextarea, IonTitle, IonToolbar],
  template: `
    <ion-header class="app-header"><ion-toolbar><ion-title>Service</ion-title></ion-toolbar></ion-header>
    <ion-content><main class="page-content service-page">
      <header class="page-intro"><div><p>Site support</p><h1>Request service</h1></div></header>
      <section class="service-form-card">
        <div class="request-type-picker" role="radiogroup" aria-label="Service needed">
          <button type="button" role="radio" [attr.aria-checked]="requestType === 'Request repair'" [class.selected]="requestType === 'Request repair'" (click)="requestType = 'Request repair'"><strong>Repair</strong><span>Something is damaged or not reporting.</span></button>
          <button type="button" role="radio" [attr.aria-checked]="requestType === 'Request more sensors'" [class.selected]="requestType === 'Request more sensors'" (click)="requestType = 'Request more sensors'"><strong>More coverage</strong><span>Monitor another area at this site.</span></button>
        </div>
        <ion-textarea label="What should we inspect?" labelPlacement="stacked" name="details" [(ngModel)]="details" maxlength="1000" autoGrow="true" placeholder="Area, concern, and when it started" />
        @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
        @if (notice()) {<p class="form-notice" role="status">{{ notice() }}</p>}
        <ion-button expand="block" [disabled]="submitting() || details.trim().length < 5" (click)="submit()">{{ submitting() ? 'Sending...' : 'Send request' }}</ion-button>
      </section>

      <section class="request-history">
        <header><h2>Recent requests</h2></header>
        @if (loading()) {
          <div class="list-skeleton compact" aria-label="Loading requests"><span></span><span></span><span></span></div>
        } @else {
          @for (request of requests(); track request.id) {
            <article><div><strong>{{ request.request_type === 'Request repair' ? 'Repair' : 'More coverage' }}</strong><span>{{ request.created_at | date: 'MMM d, y' }}</span></div><span class="status-chip">{{ requestStatus(request) }}</span></article>
          } @empty {
            <div class="state-card fixed-footprint"><h3>No service requests</h3><p>Your submitted requests will appear here.</p></div>
          }
        }
      </section>
    </main></ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicePage {
  requestType: 'Request repair' | 'Request more sensors' = 'Request repair';
  details = '';
  readonly requests = signal<CustomerRequest[]>([]);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  constructor(private readonly api: CustomerApi) { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    try { this.requests.set(await this.api.requests()); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Requests could not be loaded.'); }
    finally { this.loading.set(false); }
  }

  async submit(): Promise<void> {
    if (this.details.trim().length < 5) return;
    this.submitting.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await this.api.createServiceRequest(this.requestType, this.details.trim());
      this.details = '';
      this.notice.set('Request sent to ExcaVision.');
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Request could not be sent.');
    } finally {
      this.submitting.set(false);
    }
  }

  requestStatus(request: CustomerRequest): string {
    if (request.service_status === 'completed') return 'Complete';
    return ({
      submitted: 'Received',
      under_review: 'Under review',
      clarification_needed: 'Details needed',
      proposal_ready: 'Proposal ready',
      changes_requested: 'Changes requested',
      approved: 'Approved',
      closed: 'Closed',
    } as Record<string, string>)[request.status] ?? request.status;
  }
}
