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

test('General: Always on Top toggle applies to the window and persists', async ({ page, userDataDir, electronApp }) => {
  const toggle = page.locator('.setting-row', { hasText: 'Always on Top' }).locator('.toggle-btn');
  await expect(toggle).not.toHaveClass(/on/); // default off

  await toggle.click();
  await expect(toggle).toHaveClass(/on/);

  // Applied to the real BrowserWindow…
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.isAlwaysOnTop()
      )
    )
    .toBe(true);

  // …and persisted for the next launch.
  await expect
    .poll(async () => (await readSettings(userDataDir)).window?.alwaysOnTop)
    .toBe(true);
});

test('switching the active translation provider persists and updates the translator pane', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: 'Providers' }).click();

  const providerSelect = page.locator('.provider-card-body select.field-select').first();
  await providerSelect.selectOption('openai');

  await expect
    .poll(async () => (await readSettings(userDataDir)).activeProvider)
    .toBe('openai');

  // The translator pane reads the same settings signal — it should no longer show Echo.
  await page.getByRole('link', { name: 'Translator' }).click();
  await expect(page.locator('.provider-tag')).not.toHaveText('Echo (E2E test)');
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

test('translation System Prompt: Reset to default persists an empty prompt (use live default)', async ({ page, userDataDir }) => {
  // "System Prompt" appears under both Translation and Assist; the first is Translation's.
  await page.getByRole('button', { name: 'System Prompt' }).first().click();
  await page.getByRole('button', { name: 'Reset to default' }).click();

  await expect(page.locator('.validation-result.valid', { hasText: 'Saved' })).toBeVisible();
  // Reset stores '' so the language-aware default is resolved live (not frozen to one
  // language); the editor still shows the default text for visibility.
  await expect
    .poll(async () => (await readSettings(userDataDir)).prompts?.translation ?? '<unset>')
    .toBe('');
});

test('translation System Prompt: editor shows the ${SOURCE}/${TARGET} token template', async ({ page }) => {
  await page.getByRole('button', { name: 'System Prompt' }).first().click();
  // The default the editor loads carries the literal tokens (resolved at call time),
  // so the variable nature is visible and editable rather than frozen to one language.
  const textarea = page.locator('.prompt-textarea');
  await expect(textarea).toHaveValue(/\$\{SOURCE\}/);
  await expect(textarea).toHaveValue(/\$\{TARGET\}/);
});

test('Hotkeys: defaults render; recording a new combo persists to settings.json', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: 'Hotkeys' }).click();

  // Seeded settings.json has no hotkeys section — the store's deep-merge
  // supplies the defaults, which the panel should show.
  const captureInput = page
    .locator('.setting-row', { hasText: 'Start / Stop Capture' })
    .locator('.hotkey-input');
  await expect(captureInput).toHaveValue('Ctrl+Alt+C');

  // Click → recording mode → the next combo (with modifiers) is captured.
  await captureInput.click();
  await expect(captureInput).toHaveValue('Press keys…');
  await page.keyboard.press('Control+Shift+F9');
  await expect(captureInput).toHaveValue('Ctrl+Shift+F9');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.validation-result.valid', { hasText: 'Saved' })).toBeVisible();
  await expect
    .poll(async () => (await readSettings(userDataDir)).hotkeys?.toggleCapture)
    .toBe('Ctrl+Shift+F9');
});

test('Hotkeys: Backspace disables a hotkey and persists an empty string', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: 'Hotkeys' }).click();

  const overlayInput = page
    .locator('.setting-row', { hasText: 'Show / Hide Overlay' })
    .locator('.hotkey-input');
  await overlayInput.click();
  await page.keyboard.press('Backspace');
  await expect(overlayInput).toHaveValue('Disabled');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(async () => (await readSettings(userDataDir)).hotkeys?.toggleOverlay ?? '<unset>')
    .toBe('');
});

test('Hotkeys: two actions sharing a combo blocks Save with a warning', async ({ page }) => {
  await page.getByRole('button', { name: 'Hotkeys' }).click();

  // Rebind overlay to the capture default → duplicate.
  const overlayInput = page
    .locator('.setting-row', { hasText: 'Show / Hide Overlay' })
    .locator('.hotkey-input');
  await overlayInput.click();
  await page.keyboard.press('Control+Alt+C');
  await expect(overlayInput).toHaveValue('Ctrl+Alt+C');

  await expect(page.locator('.validation-result.invalid', { hasText: 'same combination' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('translation System Prompt: a custom prompt with tokens persists verbatim', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: 'System Prompt' }).first().click();
  await page.locator('.prompt-textarea').fill('From ${SOURCE} to ${TARGET}');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.locator('.validation-result.valid', { hasText: 'Saved' })).toBeVisible();
  // Stored with the tokens intact (NOT pre-substituted) so main resolves them live
  // against the configured language pair on every translate.
  await expect
    .poll(async () => (await readSettings(userDataDir)).prompts?.translation ?? '<unset>')
    .toBe('From ${SOURCE} to ${TARGET}');
});
