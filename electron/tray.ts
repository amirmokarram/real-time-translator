import { app, BrowserWindow, Menu, Tray } from 'electron';
import { OverlayManager } from './overlay-window';
import { AudioCapture } from './audio-capture';
import { publicAsset } from './assets';

/**
 * System tray icon + context menu. Lets the app keep running (and translating)
 * with the main window hidden: show/hide window, start/stop capture, toggle
 * overlay, quit. Menu labels track live state — call refresh() whenever the
 * window/capture/overlay state changes so "Start Capture" flips to "Stop
 * Capture", etc.
 */
export class TrayManager {
  private tray: Tray | null = null;
  // Last icon we handed to setImage. refresh() runs on window show/hide too,
  // so without this the .ico would be re-read from disk on every menu rebuild.
  private currentIcon: string | null = null;

  constructor(
    // Getter (not a captured reference) so a recreated main window (macOS
    // activate) is always the one we act on.
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly overlayManager: OverlayManager,
    private readonly audioCapture: AudioCapture,
    // Always-on-top state/toggle — owned by main.ts (persisted in settings).
    private readonly windowPrefs: {
      isAlwaysOnTop: () => boolean;
      toggleAlwaysOnTop: () => void;
    }
  ) {}

  create(): void {
    if (this.tray) return;
    this.tray = new Tray(this.iconPath(this.audioCapture.isActive()));
    this.tray.on('double-click', () => this.showMainWindow());
    this.refresh();
  }

  /** Rebuild the context menu + icon so both reflect current state. */
  refresh(): void {
    if (!this.tray) return;
    const win = this.getMainWindow();
    const winVisible = !!win && !win.isDestroyed() && win.isVisible();

    this.applyIcon(this.audioCapture.isActive());

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: winVisible ? 'Hide Window' : 'Show Window',
          click: () => this.toggleMainWindow(),
        },
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: this.windowPrefs.isAlwaysOnTop(),
          click: () => this.windowPrefs.toggleAlwaysOnTop(),
        },
        {
          label: this.audioCapture.isActive() ? 'Stop Capture' : 'Start Capture',
          click: () => this.toggleCapture(),
        },
        {
          label: this.overlayManager.isOpen() ? 'Hide Overlay' : 'Show Overlay',
          click: () => {
            this.overlayManager.toggle();
            this.refresh();
          },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ])
    );
  }

  /** Show ↔ hide the main window (tray menu; later also the global hotkey). */
  toggleMainWindow(): void {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isVisible() && !win.isMinimized()) {
      win.hide();
    } else {
      this.showMainWindow();
    }
    this.refresh();
  }

  /** Ask the renderer to toggle capture — getUserMedia must run there. */
  toggleCapture(): void {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('command:toggle-capture');
  }

  private showMainWindow(): void {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    this.refresh();
  }

  /**
   * Swap the tray icon + tooltip to match capture state, so a hidden window
   * still tells you at a glance whether the app is listening. Both icons share
   * a silhouette — only the waveform bars change (hollow → teal) — so the tray
   * never appears to jump.
   */
  private applyIcon(capturing: boolean): void {
    const icon = this.iconPath(capturing);
    if (!this.tray || icon === this.currentIcon) return;
    this.tray.setImage(icon);
    this.tray.setToolTip(
      capturing ? 'Earshot — capturing' : 'Earshot'
    );
    this.currentIcon = icon;
  }

  // Glyph-only icons sized for the tray (16/20/24/32/40/48) — the app's own
  // icon.ico is a squircle tile, which at 16px is mostly frame.
  private iconPath(capturing: boolean): string {
    return publicAsset(capturing ? 'tray-active.ico' : 'tray.ico');
  }
}
