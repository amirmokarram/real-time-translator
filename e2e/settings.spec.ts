import { test, expect } from './fixtures';
import { readSettings } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.locator('.settings-layout')).toBeVisible();
});

test('General: toggling Show Interim Results persists to settings.json', async ({ page, userDataDir }) => {
  const toggle = page.locator('.setting-row', { hasText: 'Show Interim Results' }).locator('.toggle-btn');
  await expect(toggle).toHaveClass(/on/); // seeded true

  await toggle.click();
  await expect(toggle).not.toHaveClass(/on/);

  await expect
    .poll(async () => (await readSettings(userDataDir)).display?.showInterimResults)
    .toBe(false);
});

test('switching the active translation provider persists and updates the header', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: 'Providers' }).click();

  const providerSelect = page.locator('.provider-card-body select.field-select').first();
  await providerSelect.selectOption('openai');

  await expect
    .poll(async () => (await readSettings(userDataDir)).activeProvider)
    .toBe('openai');

  // Header reads the same settings signal — it should no longer show Echo.
  await page.getByRole('link', { name: 'Translator' }).click();
  await expect(page.locator('.provider-label')).not.toHaveText('Echo (E2E test)');
});

test('saving a provider API key persists it to settings.json', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: 'Providers' }).click();

  // Echo has no config fields; switch to Claude to get an API-key field.
  await page.locator('.provider-card-body select.field-select').first().selectOption('claude');
  await page.locator('.provider-card-body input[type="password"]').fill('sk-ant-e2e-key');
  await page.locator('.provider-card-actions .btn-save').click();

  await expect
    .poll(async () => (await readSettings(userDataDir)).providers?.claude?.apiKey)
    .toBe('sk-ant-e2e-key');
});

test('translation System Prompt: Reset to default persists a non-empty prompt', async ({ page, userDataDir }) => {
  // "System Prompt" appears under both Translation and Assist; the first is Translation's.
  await page.getByRole('button', { name: 'System Prompt' }).first().click();
  await page.getByRole('button', { name: 'Reset to default' }).click();

  await expect(page.locator('.validation-result.valid', { hasText: 'Saved' })).toBeVisible();
  await expect
    .poll(async () => ((await readSettings(userDataDir)).prompts?.translation ?? '').length)
    .toBeGreaterThan(0);
});
