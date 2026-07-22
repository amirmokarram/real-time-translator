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
    this.tray = new Tray(this.iconPath());
    this.tray.setToolTip('Real-Time Translator');
    this.tray.on('double-click', () => this.showMainWindow());
    this.refresh();
  }

  /** Rebuild the context menu so labels reflect current state. */
  refresh(): void {
    if (!this.tray) return;
    const win = this.getMainWindow();
    const winVisible = !!win && !win.isDestroyed() && win.isVisible();

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

  // Glyph-only icon sized for the tray (16/20/24/32/40/48) — the app's own
  // icon.ico is a squircle tile, which at 16px is mostly frame. tray-active.ico
  // is the same silhouette with teal bars, for a future "capturing" state.
  private iconPath(): string {
    return publicAsset('tray.ico');
  }
}
