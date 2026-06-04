import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SettingsService } from '../../core/services/settings.service';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';

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

  protected showProviderMenu = signal(false);
  protected overlayOpen = signal(false);

  async ngOnInit(): Promise<void> {
    this.overlayOpen.set(await this.bridge.isOverlayOpen());
    this.bridge.onOverlayState((open) => this.overlayOpen.set(open));
  }

  protected async toggleOverlay(): Promise<void> {
    const open = await this.bridge.toggleOverlay();
    this.overlayOpen.set(open);
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
