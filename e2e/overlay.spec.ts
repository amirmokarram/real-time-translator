import { test, expect } from './fixtures';
import { openOverlay, startCapture, say } from './helpers';

test('opens as a second window and mirrors committed translations', async ({ page, electronApp }) => {
  const overlay = await openOverlay(electronApp, page);
  await expect(overlay.locator('.overlay-idle')).toBeVisible();

  // A committed translation in the main window broadcasts to all windows.
  await startCapture(page);
  await say(page, 'Hello world.');

  await expect(overlay.locator('.overlay-fa')).toHaveText('[fa] Hello world.');
  await expect(overlay.locator('.overlay-en')).toHaveText('Hello world.');
});

test('toggling click-through flips the overlay root state', async ({ page, electronApp }) => {
  const overlay = await openOverlay(electronApp, page);

  const root = overlay.locator('.overlay-root');
  await expect(root).not.toHaveClass(/click-through/);

  await overlay.getByTitle('Click-through OFF').click();
  await expect(root).toHaveClass(/click-through/);
});

test('closing the overlay from its toolbar removes the window', async ({ page, electronApp }) => {
  const overlay = await openOverlay(electronApp, page);
  await overlay.locator('.ov-btn.close').click();
  await expect.poll(() => electronApp.windows().some((w) => w.url().includes('/overlay'))).toBe(false);
});
