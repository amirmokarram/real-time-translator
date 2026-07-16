import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SettingsService } from '../../core/services/settings.service';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { AssistService } from '../../core/services/assist.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent implements OnInit {
  protected settings = inject(SettingsService);
  protected bridge = inject(ElectronBridgeService);
  protected assist = inject(AssistService);

  protected showProviderMenu = signal(false);
  protected overlayOpen = signal(false);
  protected alwaysOnTop = signal(false);

  async ngOnInit(): Promise<void> {
    this.overlayOpen.set(await this.bridge.isOverlayOpen());
    this.bridge.onOverlayState((open) => this.overlayOpen.set(open));
    // Any of the three always-on-top controls (pin/tray/Settings) may flip the
    // state — the broadcast keeps the pin in sync no matter which one did.
    this.alwaysOnTop.set(await this.bridge.isAlwaysOnTop());
    this.bridge.onAlwaysOnTopState((on) => this.alwaysOnTop.set(on));
  }

  protected async toggleOverlay(): Promise<void> {
    const open = await this.bridge.toggleOverlay();
    this.overlayOpen.set(open);
  }

  protected async toggleAlwaysOnTop(): Promise<void> {
    this.alwaysOnTop.set(await this.bridge.toggleAlwaysOnTop());
  }

  protected toggleAssist(): void {
    this.assist.toggle();
  }

  protected get activeProviderName(): string {
    const id = this.settings.activeProvider();
    return this.settings.providerMeta(id)?.name ?? id;
  }

  protected selectProvider(id: string): void {
    this.settings.setActiveProvider(id);
    this.showProviderMenu.set(false);
  }

  protected toggleProviderMenu(): void {
    this.showProviderMenu.update((v) => !v);
  }

  protected closeMenu(): void {
    this.showProviderMenu.set(false);
  }
}
