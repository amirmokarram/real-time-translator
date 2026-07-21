import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { buildSeedSettings, SeedOverrides } from './seed-settings';

const PROJECT_ROOT = path.join(__dirname, '..');

interface Fixtures {
  // Per-test STT/translation tweaks baked into the seeded settings.json.
  seed: SeedOverrides;
  // Fresh temp userData dir for this test; holds the live settings.json.
  userDataDir: string;
  electronApp: ElectronApplication;
  page: Page;
  // Destination the E2E export-dialog bypass writes to (assert its contents).
  exportPath: string;
  // Empty temp folder session recordings are written to. Injected into the seed
  // whenever a test enables recording, so specs can list it and assert on files.
  recordingsDir: string;
}

export const test = base.extend<Fixtures>({
  seed: [{}, { option: true }],

  exportPath: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtt-e2e-export-'));
    await use(path.join(dir, 'history-export.txt'));
    await fs.rm(dir, { recursive: true, force: true });
  },

  recordingsDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtt-e2e-rec-'));
    await use(dir);
    await fs.rm(dir, { recursive: true, force: true });
  },

  userDataDir: async ({ seed, recordingsDir }, use) => {
    // Fresh userData per test → isolated settings.json, no cross-test bleed.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtt-e2e-'));
    // A test that asks for recording gets the temp folder for free; it can still
    // override folderPath explicitly if it needs to point somewhere else.
    const merged = seed.recording
      ? { ...seed, recording: { folderPath: recordingsDir, ...seed.recording } }
      : seed;
    await fs.writeFile(
      path.join(dir, 'settings.json'),
      JSON.stringify(buildSeedSettings(merged), null, 2),
      'utf-8'
    );
    await use(dir);
    await fs.rm(dir, { recursive: true, force: true });
  },

  electronApp: async ({ userDataDir, exportPath }, use) => {
    const app = await electron.launch({
      args: [
        PROJECT_ROOT,
        `--user-data-dir=${userDataDir}`,
        // Make getUserMedia resolve headlessly with a silent fake audio track
        // (the MockSttStream ignores the audio; we only need capture to start).
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
      env: {
        ...process.env,
        ELECTRON_DEV: '',
        TRANSLATOR_E2E: '1',
        TRANSLATOR_E2E_EXPORT_PATH: exportPath,
      },
    });

    await use(app);

    await app.close();
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector('app-root', { state: 'attached' });
    await use(page);
  },
});

export { expect } from '@playwright/test';
