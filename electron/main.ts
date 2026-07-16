import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { SettingsStore } from './settings-store';
import { OverlayManager } from './overlay-window';
import { AudioCapture } from './audio-capture';
import { TrayManager } from './tray';

const isDev = process.env['ELECTRON_DEV'] === 'true';
// E2E runs skip the tray + close-to-tray interception: Playwright must be able
// to really close the window/app, and CI runners have no usable tray.
const isE2E = !!process.env['TRANSLATOR_E2E'];

// Dev hot-reload relaunches Electron while the previous instance is still
// releasing its disk cache, so every boot logs noisy (but harmless)
// "Unable to move the cache: Access is denied" / "Gpu Cache Creation failed"
// errors. The HTTP and GPU shader disk caches buy nothing in dev — keep them
// off so the console stays clean. Packaged builds are unaffected.
if (isDev) {
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
}

let mainWindow: BrowserWindow | null = null;
// True once a real quit is underway (tray Quit / OS shutdown both fire
// before-quit) — lets the close-to-tray interception stand down.
let isQuitting = false;
const settingsStore = new SettingsStore();
const audioCapture = new AudioCapture();

const overlayManager = new OverlayManager(isDev, (open) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay:state', open);
  }
  trayManager.refresh();
});

const trayManager = new TrayManager(() => mainWindow, overlayManager, audioCapture);

// Route all external (http/https) links to the system browser instead of
// navigating the app window in-place (which would break the SPA). Covers both
// window.open / target=_blank and direct in-place navigations.
function openLinksExternally(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    // Allow the app's own load (dev server); send everything else to the browser.
    if (/^https?:\/\//.test(url) && !url.startsWith('http://localhost:4200')) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#0f1117',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:4200');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, '../dist/renderer/browser/index.html')
    );
  }

  openLinksExternally(mainWindow.webContents);

  // Close-to-tray: X hides the window and the app keeps translating from the
  // tray (Settings → General toggle). A real quit (tray menu / OS shutdown)
  // sets isQuitting via before-quit and passes through.
  mainWindow.on('close', (event) => {
    if (isQuitting || isE2E) return;
    if (settingsStore.get().tray.closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Keep the tray's Show/Hide label in sync however visibility changes.
  mainWindow.on('show', () => trayManager.refresh());
  mainWindow.on('hide', () => trayManager.refresh());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await settingsStore.load();

  if (isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            // ws://localhost:* / http://localhost:* allow a local Whisper (WhisperLive) STT server on any port.
            "default-src 'self' http://localhost:4200; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:4200; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https: wss: ws://localhost:* http://localhost:*",
          ],
        },
      });
    });
  }

  createMainWindow();
  if (!isE2E) trayManager.create();
  registerIpcHandlers(
    ipcMain,
    mainWindow!,
    settingsStore,
    overlayManager,
    audioCapture,
    trayManager
  );
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
