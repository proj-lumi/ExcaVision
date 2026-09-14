import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton } from '@ionic/angular/ion-button';
import { IonContent } from '@ionic/angular/ion-content';
import { IonInput } from '@ionic/angular/ion-input';
import { IonItem } from '@ionic/angular/ion-item';
import { IonSpinner } from '@ionic/angular/ion-spinner';
import { AuthService } from './auth.service';
import { initializeIonic } from './initialize-ionic';

@Component({
  imports: [FormsModule, IonButton, IonContent, IonInput, IonItem, IonSpinner],
  template: `
    <ion-content class="auth-page">
      <main class="auth-shell">
        <section class="auth-brand"><span class="brand-mark">EX</span><strong>ExcaVision</strong><p>Customer monitoring</p></section>
        <form class="auth-card" (ngSubmit)="signIn()">
          <header><h1>Sign in</h1><p>Use the account from your private invitation.</p></header>
          <ion-item lines="none"><ion-input label="Email" labelPlacement="stacked" type="email" name="email" [(ngModel)]="email" autocomplete="email" required /></ion-item>
          <ion-item lines="none"><ion-input label="Password" labelPlacement="stacked" type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required /></ion-item>
          @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
          <ion-button type="submit" expand="block" [disabled]="busy()">@if (busy()) {<ion-spinner name="crescent" />} @else {Sign in}</ion-button>
          @if (!auth.configured) {<p class="form-error" role="alert">Customer app configuration is missing.</p>}
        </form>
      </main>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');

  constructor(readonly auth: AuthService, private readonly router: Router) {
    initializeIonic();
    if (auth.signedIn()) void router.navigateByUrl('/dashboard');
  }

  async signIn(): Promise<void> {
    if (!this.email.trim() || !this.password) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signIn(this.email.trim(), this.password);
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Sign in failed.');
    } finally {
      this.busy.set(false);
    }
  }
}
