import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/header/header';
import { AssistPanelComponent } from './features/assist/assist-panel';
import { SettingsService } from './core/services/settings.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, AssistPanelComponent],
  template: `
    @if (isOverlay) {
      <router-outlet />
    } @else {
      <div class="app-shell">
        <app-header />
        <main class="main-content">
          <router-outlet />
          <!-- Assist slide-in panel — app-level so it works from any route -->
          <app-assist-panel />
        </main>
      </div>
    }
  `,
  styles: [`
    .app-shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .main-content {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      // Containing block for the absolutely-positioned assist slide-in panel
      position: relative;
    }
  `],
})
export class App implements OnInit {
  private settings = inject(SettingsService);

  // The overlay window loads at #/overlay — render bare, no header/shell
  protected readonly isOverlay =
    typeof window !== 'undefined' && window.location.hash.includes('overlay');

  async ngOnInit(): Promise<void> {
    if (this.isOverlay) {
      // Overlay needs a transparent background; the global body bg is opaque
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
    }
    await this.settings.init();
  }
}
