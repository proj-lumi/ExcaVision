import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular/ion-icon';
import { addIcons } from 'ionicons';
import { homeOutline, notificationsOutline, constructOutline } from 'ionicons/icons';
import { initializeIonic } from './initialize-ionic';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IonIcon],
  template: `
    <div class="customer-shell">
      <router-outlet />
      <nav class="customer-tabs" aria-label="Customer navigation">
        <a routerLink="/dashboard" routerLinkActive="active"><ion-icon name="home-outline" /><span>Site</span></a>
        <a routerLink="/alerts" routerLinkActive="active"><ion-icon name="notifications-outline" /><span>Alerts</span></a>
        <a routerLink="/service" routerLinkActive="active"><ion-icon name="construct-outline" /><span>Service</span></a>
      </nav>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellPage {
  constructor() {
    initializeIonic();
    addIcons({ homeOutline, notificationsOutline, constructOutline });
  }
}
