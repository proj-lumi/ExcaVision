import { initialize } from '@ionic/core/components';

let initialized = false;

export function initializeIonic(): void {
  if (initialized) return;
  document.documentElement.classList.add('ion-ce');
  initialize({ mode: 'md', animated: false });
  initialized = true;
}
