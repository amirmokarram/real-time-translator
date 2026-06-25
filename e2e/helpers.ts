import * as fs from 'fs/promises';
import * as path from 'path';
import { ElectronApplication, Page, expect } from '@playwright/test';
import { E2eSttDetail } from '../src/app/core/services/stt/mock-stream';

// Read the live settings.json the app persists into its userData dir. Returns
// {} until the file lands (the renderer save → IPC → main write is async).
export async function readSettings(userDataDir: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(path.join(userDataDir, 'settings.json'), 'utf-8'));
  } catch {
    return {};
  }
}

// Push a scripted STT event into the running renderer (consumed by MockSttStream).
export async function feed(page: Page, detail: E2eSttDetail): Promise<void> {
  await page.evaluate(
    (d) => window.dispatchEvent(new CustomEvent('e2e-stt', { detail: d })),
    detail
  );
}

// Commit one finished sentence (text must end in . ! ?). Shorthand for the
// common "speaker said a full sentence and paused" case.
export async function say(page: Page, text: string): Promise<void> {
  await feed(page, { kind: 'final', text, endOfUtterance: true });
}

// Select a microphone source (backed by the fake device, so getUserMedia resolves
// headlessly — unlike the desktop-loopback path) and start capturing.
export async function startCapture(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const sel = document.querySelector('select.source-select') as HTMLSelectElement | null;
    return !!sel && Array.from(sel.options).some((o) => o.value.startsWith('mic:'));
  });
  const micValue = await page.evaluate(() => {
    const sel = document.querySelector('select.source-select') as HTMLSelectElement;
    return Array.from(sel.options).find((o) => o.value.startsWith('mic:'))!.value;
  });
  await page.selectOption('select.source-select', micValue);
  await page.click('button.capture-btn');
  await expect(page.locator('.live-panel')).toBeVisible();
}

// Toggle the overlay from the header and return its (second) BrowserWindow Page.
// The window-wait is armed before the click so the 'window' event can't be missed.
export async function openOverlay(app: ElectronApplication, page: Page): Promise<Page> {
  const existing = app.windows().find((w) => w.url().includes('/overlay'));
  if (existing) return existing;

  const overlayPromise = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Overlay' }).click();
  const overlay = await overlayPromise;

  await overlay.waitForURL(/\/overlay/);
  await overlay.waitForSelector('app-overlay', { state: 'attached' });
  return overlay;
}
