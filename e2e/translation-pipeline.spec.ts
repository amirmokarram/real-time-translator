import { test, expect } from './fixtures';
import { startCapture, say, feed } from './helpers';

test('captures, transcribes, and translates a sentence into a history row', async ({ page }) => {
  await startCapture(page);
  await say(page, 'Hello world.');

  const row = page.locator('.history-row').first();
  await expect(row).toBeVisible();
  await expect(row.locator('.hcell-en .hcell-text')).toHaveText('Hello world.');
  await expect(row.locator('.hcell-fa .persian-text')).toHaveText('[fa] Hello world.');
  await expect(row.locator('.hcell-fa .hcell-meta')).toContainText('echo');
});

test('commits multiple sentences as separate rows, in order', async ({ page }) => {
  await startCapture(page);
  await say(page, 'First sentence.');
  await say(page, 'Second sentence.');

  const en = page.locator('.history-row .hcell-en .hcell-text');
  await expect(en).toHaveCount(2);
  await expect(en.nth(0)).toHaveText('First sentence.');
  await expect(en.nth(1)).toHaveText('Second sentence.');
});

test('segments two sentences arriving in one utterance into two rows', async ({ page }) => {
  await startCapture(page);
  // One finalized chunk containing two sentences, then a pause.
  await feed(page, { kind: 'final', text: 'One two three. Four five six.', endOfUtterance: true });

  await expect(page.locator('.history-row')).toHaveCount(2);
  await expect(page.locator('.history-row .hcell-en .hcell-text').nth(0)).toHaveText('One two three.');
  await expect(page.locator('.history-row .hcell-en .hcell-text').nth(1)).toHaveText('Four five six.');
});

test.describe('live partial preview', () => {
  test.use({ seed: { livePartial: true } });

  test('translates in-progress speech, then the committed row supersedes it', async ({ page }) => {
    await startCapture(page);

    // Interim words → debounced live-preview translation in the FA live cell.
    await feed(page, { kind: 'interim', text: 'streaming preview' });
    await expect(page.locator('.live-cell-fa .live-text')).toHaveText('[fa] streaming preview');

    // Finalizing the sentence commits a row and clears the preview.
    await say(page, 'streaming preview done.');
    await expect(page.locator('.history-row .hcell-fa .persian-text').last())
      .toHaveText('[fa] streaming preview done.');
    await expect(page.locator('.live-cell-fa .live-text')).toHaveText('…');
  });
});
