import { defineConfig } from '@playwright/test';

// E2E suite drives the *built* Electron app (see e2e/fixtures.ts). Electron is
// heavy and the app uses a single shared settings file per launch, so we run
// serially with one worker. Run `npm run electron:build` first (or use the
// `npm run e2e` script which is documented in README to do both).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
});
