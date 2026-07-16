import { Injectable, inject } from '@angular/core';
import { ElectronBridgeService } from './electron-bridge.service';
import { AudioService } from './audio.service';
import { TranslationService } from './translation.service';

/**
 * Dispatches commands sent by the MAIN process (tray menu, later global
 * hotkeys) to the right renderer service. Lives at root so commands work from
 * any route — capture state is in AudioService, not a component. Initialized
 * once by the app shell (main window only; the overlay doesn't capture).
 */
@Injectable({ providedIn: 'root' })
export class CommandService {
  private bridge = inject(ElectronBridgeService);
  private audio = inject(AudioService);
  private translation = inject(TranslationService);
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.bridge.onToggleCaptureCommand(() => void this.toggleCapture());
  }

  // Mirrors TranslatorComponent.toggleCapture: stop also clears the live
  // partial preview so no stale in-progress row lingers.
  private async toggleCapture(): Promise<void> {
    if (this.audio.isCapturing()) {
      await this.audio.stopCapture();
      this.translation.clearLivePartial();
    } else {
      // Sources normally load when the translator route mounts; make the
      // command self-sufficient in case it fires before that (e.g. from tray
      // while the window sits on Settings after a fresh start).
      if (this.audio.sources().length === 0) await this.audio.loadSources();
      await this.audio.startCapture();
    }
  }
}
