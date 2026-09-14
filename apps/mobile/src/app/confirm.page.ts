import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular/ion-button';
import { IonContent } from '@ionic/angular/ion-content';
import { IonInput } from '@ionic/angular/ion-input';
import { IonItem } from '@ionic/angular/ion-item';
import { IonSpinner } from '@ionic/angular/ion-spinner';
import { AuthService } from './auth.service';
import { initializeIonic } from './initialize-ionic';

@Component({
  imports: [FormsModule, RouterLink, IonButton, IonContent, IonInput, IonItem, IonSpinner],
  template: `
    <ion-content class="auth-page">
      <main class="auth-shell">
        <section class="auth-brand"><span class="brand-mark">EX</span><strong>ExcaVision</strong><p>Secure account setup</p></section>
        <form class="auth-card" (ngSubmit)="activate()">
          <header><h1>Create password</h1><p>Finish access to your commissioned monitoring site.</p></header>
          @if (inviteValid()) {
            <ion-item lines="none"><ion-input label="Password" labelPlacement="stacked" type="password" name="password" [(ngModel)]="password" minlength="10" autocomplete="new-password" required /></ion-item>
            <ion-item lines="none"><ion-input label="Confirm password" labelPlacement="stacked" type="password" name="confirmation" [(ngModel)]="confirmation" minlength="10" autocomplete="new-password" required /></ion-item>
            @if (error()) {<p class="form-error" role="alert">{{ error() }}</p>}
            <ion-button type="submit" expand="block" [disabled]="busy()">@if (busy()) {<ion-spinner name="crescent" />} @else {Activate account}</ion-button>
          } @else {
            <p class="form-error" role="alert">This invitation link is invalid or expired.</p>
            <ion-button type="button" fill="outline" expand="block" routerLink="/login">Return to sign in</ion-button>
          }
        </form>
      </main>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmPage {
  password = '';
  confirmation = '';
  readonly inviteValid = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');

  constructor(private readonly auth: AuthService, private readonly router: Router) {
    initializeIonic();
    this.inviteValid.set(auth.acceptInvitationFromUrl() || auth.signedIn());
  }

  async activate(): Promise<void> {
    if (this.password.length < 10) {
      this.error.set('Use at least 10 characters.');
      return;
    }
    if (this.password !== this.confirmation) {
      this.error.set('Passwords do not match.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.setPassword(this.password);
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Account setup failed.');
    } finally {
      this.busy.set(false);
    }
  }
}
