import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { SettingsStore } from './settings-store';
import { OverlayManager } from './overlay-window';

const isDev = process.env['ELECTRON_DEV'] === 'true';

let mainWindow: BrowserWindow | null = null;
const settingsStore = new SettingsStore();

const overlayManager = new OverlayManager(isDev, (open) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay:state', open);
  }
});

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
            "default-src 'self' http://localhost:4200; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:4200; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https: wss: ws://localhost:4200",
          ],
        },
      });
    });
  }

  createMainWindow();
  registerIpcHandlers(ipcMain, mainWindow!, settingsStore, overlayManager);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
