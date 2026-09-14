import { Routes } from '@angular/router';
import { customerGuard } from './auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./login.page').then((module) => module.LoginPage) },
  { path: 'auth/confirm', loadComponent: () => import('./confirm.page').then((module) => module.ConfirmPage) },
  {
    path: '',
    canActivate: [customerGuard],
    loadComponent: () => import('./shell.page').then((module) => module.ShellPage),
    children: [
      { path: 'dashboard', loadComponent: () => import('./dashboard.page').then((module) => module.DashboardPage) },
      { path: 'alerts', loadComponent: () => import('./alerts.page').then((module) => module.AlertsPage) },
      { path: 'service', loadComponent: () => import('./service.page').then((module) => module.ServicePage) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: '' },
];
