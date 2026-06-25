import { test, expect } from './fixtures';

test('boots into the translator shell with the seeded provider', async ({ page }) => {
  await expect(page.locator('header.app-header')).toBeVisible();
  await expect(page.locator('.app-name')).toHaveText('Real-Time Translator');
  await expect(page.locator('.translator-layout')).toBeVisible();

  // Confirms the echo provider is registered (TRANSLATOR_E2E) and settings loaded
  // from the seeded settings.json (activeProvider === 'echo').
  await expect(page.locator('.provider-label')).toHaveText('Echo (E2E test)');

  // Frameless custom window controls render on non-darwin.
  await expect(page.locator('.window-controls .win-btn.close')).toBeVisible();
});

test('navigates between Translator and Settings (hash routing)', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect.poll(() => page.url()).toContain('/settings');
  await expect(page.locator('.translator-layout')).toHaveCount(0);

  await page.getByRole('link', { name: 'Translator' }).click();
  await expect(page.locator('.translator-layout')).toBeVisible();
});

test('boots without uncaught renderer exceptions', async ({ electronApp }) => {
  const page = await electronApp.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.reload();
  await page.waitForSelector('.translator-layout');

  expect(errors).toEqual([]);
});
