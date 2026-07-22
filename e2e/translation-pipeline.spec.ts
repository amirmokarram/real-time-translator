import { test, expect } from './fixtures';
import { startCapture, say, feed } from './helpers';

test('captures, transcribes, and translates a sentence into a history row', async ({ page }) => {
  await startCapture(page);
  await say(page, 'Hello world.');

  const row = page.locator('.history-row').first();
  await expect(row).toBeVisible();
  await expect(row.locator('.hcell-en .hcell-text')).toHaveText('Hello world.');
  await expect(row.locator('.hcell-fa .target-text')).toHaveText('[fa] Hello world.');
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

test('renders source LTR and the RTL target with the correct per-cell text direction', async ({ page }) => {
  // Seeded pair is en→fa: the source text reads LTR, the target (Persian) RTL. Direction
  // is applied only on the rendered text <p>, driven by each language's rtl flag.
  await startCapture(page);
  await say(page, 'Hello world.');

  const row = page.locator('.history-row').first();
  await expect(row.locator('.hcell-en .hcell-text')).toHaveAttribute('dir', 'ltr');
  await expect(row.locator('.hcell-fa .target-text')).toHaveAttribute('dir', 'rtl');
  await expect(row.locator('.hcell-fa .target-text')).toHaveClass(/rtl-text/);
});

test('resolves ${SOURCE}/${TARGET} tokens to the configured language names at translate time', async ({ page }) => {
  // Save a custom prompt that uses the tokens, then drive a translation: the test-only
  // EchoProvider echoes the RESOLVED prompt for the sentinel input, proving substitution
  // happens at call time in the main process (not frozen when the prompt was saved).
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'System Prompt' }).first().click();
  await page.locator('.prompt-textarea').fill('From ${SOURCE} to ${TARGET}');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.validation-result.valid', { hasText: 'Saved' })).toBeVisible();

  await page.getByRole('link', { name: 'Translator' }).click();
  await startCapture(page);
  await say(page, '__RESOLVED_PROMPT__.');

  await expect(page.locator('.history-row .hcell-fa .target-text').first())
    .toHaveText('From English to Persian');
});

test.describe('trailing-sentence commit', () => {
  // The idle fallback is pushed far out so these assertions can only be satisfied
  // by the punctuation rules, never by the safety timer firing behind them.
  test.use({ seed: { sentenceMaxWaitMs: 60000 } });

  test('commits a finished sentence without waiting for the next utterance', async ({ page }) => {
    await startCapture(page);
    // Mid-utterance: no endOfUtterance and no following words. This used to sit in
    // the buffer until the speaker's next sentence arrived.
    await feed(page, { kind: 'final', text: 'The build is green.' });

    await expect(page.locator('.history-row .hcell-en .hcell-text'))
      .toHaveText(['The build is green.']);
  });

  test('holds a tail whose dot is an abbreviation, and keeps the sentence whole', async ({ page }) => {
    await startCapture(page);
    await feed(page, { kind: 'final', text: 'I met Dr.' });
    await expect(page.locator('.history-row')).toHaveCount(0);

    // The continuation proves the "." was never a boundary: one row, not two.
    await feed(page, { kind: 'final', text: 'Smith yesterday. Today I rested.' });
    await expect(page.locator('.history-row .hcell-en .hcell-text'))
      .toHaveText(['I met Dr. Smith yesterday.', 'Today I rested.']);
  });

  test('still splits after a version number or a spoken numeral', async ({ page }) => {
    await startCapture(page);
    // The abbreviation guard must not over-reach: numbers end sentences all the
    // time once DeepGram's numerals=true turns spoken digits into figures.
    await feed(page, { kind: 'final', text: 'We shipped v1.2. The team is 25.' });

    await expect(page.locator('.history-row .hcell-en .hcell-text'))
      .toHaveText(['We shipped v1.2.', 'The team is 25.']);
  });
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
    await expect(page.locator('.history-row .hcell-fa .target-text').last())
      .toHaveText('[fa] streaming preview done.');
    await expect(page.locator('.live-cell-fa .live-text')).toHaveText('…');
  });
});
