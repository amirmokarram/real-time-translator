import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/translator/translator').then((m) => m.TranslatorComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings').then((m) => m.SettingsComponent),
  },
  {
    path: 'overlay',
    loadComponent: () =>
      import('./features/overlay/overlay').then((m) => m.OverlayComponent),
  },
  { path: '**', redirectTo: '' },
];
