import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

/**
 * Manages the floating always-on-top subtitle overlay window.
 * Loads the same Angular app at the `#/overlay` route, but transparent & frameless.
 */
export class OverlayManager {
  private overlay: BrowserWindow | null = null;

  constructor(
    private readonly isDev: boolean,
    private readonly onStateChange: (open: boolean) => void
  ) {}

  toggle(): boolean {
    if (this.overlay) {
      this.close();
      return false;
    }
    this.create();
    return true;
  }

  isOpen(): boolean {
    return !!this.overlay && !this.overlay.isDestroyed();
  }

  close(): void {
    if (this.overlay && !this.overlay.isDestroyed()) {
      this.overlay.close();
    }
  }

  getWindow(): BrowserWindow | null {
    return this.overlay;
  }

  private create(): void {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;

    const w = Math.min(900, Math.round(width * 0.6));
    const h = 170;

    this.overlay = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round((width - w) / 2),
      y: height - h - 60,
      minWidth: 320,
      minHeight: 90,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Float above fullscreen apps (meetings, videos)
    this.overlay.setAlwaysOnTop(true, 'screen-saver');
    this.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (this.isDev) {
      this.overlay.loadURL('http://localhost:4200/#/overlay');
    } else {
      this.overlay.loadFile(
        path.join(__dirname, '../dist/renderer/browser/index.html'),
        { hash: '/overlay' }
      );
    }

    this.overlay.on('closed', () => {
      this.overlay = null;
      this.onStateChange(false);
    });

    this.onStateChange(true);
  }
}
