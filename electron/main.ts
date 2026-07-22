import { app, BrowserWindow, ipcMain, protocol, session, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { Readable } from 'stream';
import { registerIpcHandlers } from './ipc-handlers';
import { resolveSessionFile } from './recording-store';
import { SettingsStore } from './settings-store';
import { OverlayManager } from './overlay-window';
import { AudioCapture } from './audio-capture';
import { TrayManager } from './tray';
import { HotkeyManager } from './hotkeys';
import { publicAsset } from './assets';

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

// Session recordings are served to the Review player over their own scheme
// instead of file://, which the renderer's CSP refuses. `stream: true` is what
// makes range requests work, and range requests are what make seeking inside a
// 50 MB meeting instant rather than a full download. Must run before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rec',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  },
]);

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

const trayManager = new TrayManager(() => mainWindow, overlayManager, audioCapture, {
  isAlwaysOnTop: () => settingsStore.get().window.alwaysOnTop,
  toggleAlwaysOnTop: () => void toggleAlwaysOnTop(),
});

// Single implementation behind all three controls (header pin, tray checkbox,
// Settings toggle): flip the persisted flag, apply it to the window, and tell
// every UI about the new state.
async function toggleAlwaysOnTop(): Promise<boolean> {
  const next = !settingsStore.get().window.alwaysOnTop;
  await settingsStore.update({ window: { alwaysOnTop: next } });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(next);
    mainWindow.webContents.send('window:always-on-top', next);
  }
  trayManager.refresh();
  return next;
}

// Global hotkeys reuse the tray's actions; the tray menu (and overlay:state
// broadcast) keep every window/label in sync no matter which path toggled.
const hotkeyManager = new HotkeyManager({
  toggleCapture: () => trayManager.toggleCapture(),
  toggleOverlay: () => overlayManager.toggle(),
  showHideWindow: () => trayManager.toggleMainWindow(),
});

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
    // Taskbar/alt-tab icon. Only read in dev — the packaged .exe carries the
    // icon electron-builder embeds from win.icon.
    icon: publicAsset('icon.ico'),
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

  // Restore the persisted always-on-top preference (settings are loaded
  // before createMainWindow runs).
  if (settingsStore.get().window.alwaysOnTop) mainWindow.setAlwaysOnTop(true);

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
            // media-src rec: lets the Review player load session recordings (see
            // the rec:// protocol handler below) — file:// would be refused here.
            "default-src 'self' http://localhost:4200; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:4200; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; media-src 'self' rec:; connect-src 'self' https: wss: ws://localhost:* http://localhost:*",
          ],
        },
      });
    });
  }

  // rec://session/<basename> → the recording of that name, and nothing else.
  // The basename comes from the renderer, so resolveSessionFile refuses anything
  // that resolves outside the recordings folder.
  //
  // Range requests are served by hand rather than delegated to net.fetch: without
  // a 206 + Content-Range the player cannot seek past what it has already
  // buffered, and a click on a transcript line snaps the audio back to the start.
  // A streamed WebM has no duration header, so the range response is the ONLY
  // thing making the file seekable.
  protocol.handle('rec', async (request) => {
    const file = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, '');
    const resolved = resolveSessionFile(settingsStore.get().recording.folderPath, file);
    if (!resolved) return new Response('Not found', { status: 404 });

    let size: number;
    try {
      size = (await fsp.stat(resolved)).size;
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const base = { 'Content-Type': 'audio/webm', 'Accept-Ranges': 'bytes' };
    const body = (start?: number, end?: number): ReadableStream =>
      Readable.toWeb(fs.createReadStream(resolved, { start, end })) as ReadableStream;

    const match = request.headers.get('Range')?.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      return new Response(body(), {
        status: 200,
        headers: { ...base, 'Content-Length': String(size) },
      });
    }

    // "bytes=N-M", "bytes=N-" (open-ended) and "bytes=-N" (final N bytes).
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : size - 1;
    if (!match[1] && match[2]) {
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);

    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { ...base, 'Content-Range': `bytes */${size}` },
      });
    }

    return new Response(body(start, end), {
      status: 206,
      headers: {
        ...base,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  });

  createMainWindow();
  if (!isE2E) trayManager.create();
  hotkeyManager.apply(settingsStore.get().hotkeys);
  registerIpcHandlers(
    ipcMain,
    mainWindow!,
    settingsStore,
    overlayManager,
    audioCapture,
    trayManager,
    hotkeyManager,
    toggleAlwaysOnTop
  );
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  hotkeyManager.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
