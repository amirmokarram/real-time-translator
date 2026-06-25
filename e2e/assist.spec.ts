import { test, expect } from './fixtures';
import { startCapture, say } from './helpers';

test('header Assist: a free-form question gets a streamed echo answer', async ({ page }) => {
  await page.getByRole('button', { name: 'Assist' }).click();
  await expect(page.locator('.assist-panel')).toBeVisible();

  await page.locator('.assist-textarea').fill('what is this');
  await page.locator('.assist-send').click();

  await expect(page.locator('.msg-user .msg-text')).toHaveText('what is this');
  await expect(page.locator('.msg-assistant .msg-text').last()).toContainText('Echo: what is this');
});

test('selecting rows and clicking Ask opens assist with context and answers', async ({ page }) => {
  await startCapture(page);
  await say(page, 'First sentence.');
  await say(page, 'Second sentence.');
  await expect(page.locator('.history-row')).toHaveCount(2);

  // Select the first row → the selection bar's Ask button opens assist with context.
  await page.locator('.history-row').first().click();
  await expect(page.locator('.selection-bar')).toBeVisible();
  await page.locator('.ask-btn').click();

  await expect(page.locator('.assist-panel')).toBeVisible();
  await expect(page.locator('.assist-context')).toBeVisible();

  // A quick action sends its prompt; the echo provider answers.
  await page.locator('.quick-btn', { hasText: 'Answer' }).click();
  await expect(page.locator('.msg-assistant .msg-text').last()).toContainText('Echo:');
});
