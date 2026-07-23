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

// A question long enough that its echoed answer overflows the thread several
// times over, so there is room for the view to drift if anything scrolls.
const LONG_QUESTION = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ');

const scrollTop = (page: import('@playwright/test').Page) =>
  page.locator('.assist-thread').evaluate((el) => el.scrollTop);

async function askLong(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Assist' }).click();
  await page.locator('.assist-textarea').fill(LONG_QUESTION);
  await page.locator('.assist-send').click();
}

test('a streaming answer never moves the scroll, wherever the reader is', async ({ page }) => {
  await askLong(page);
  const thread = page.locator('.assist-thread');

  // Wait until there is genuinely somewhere to drift to.
  await expect
    .poll(() => thread.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(200);

  const parked = await scrollTop(page);

  // Sample repeatedly while the rest of the answer streams in. Every sample
  // must be identical — this is the whole point of the feature.
  const heightAtStart = await thread.evaluate((el) => el.scrollHeight);
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(100);
    samples.push(await scrollTop(page));
  }

  // Sanity: the thread really did keep growing under us.
  expect(await thread.evaluate((el) => el.scrollHeight)).toBeGreaterThan(heightAtStart);
  expect(samples).toEqual(samples.map(() => parked));
});

test('asking puts the new question at the top so the answer fills the space below', async ({ page }) => {
  await askLong(page);

  // The question should be parked near the top of the scrollport, not pushed
  // off it — that is what lets the answer be read from its first word.
  const gap = await page.locator('.assist-thread').evaluate((el) => {
    const q = el.querySelectorAll<HTMLElement>('.msg-user');
    return q[q.length - 1].getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(40);
});

test('Jump to latest catches up to the live end on demand', async ({ page }) => {
  await askLong(page);
  const thread = page.locator('.assist-thread');

  // Since nothing auto-scrolls, the live end drifts out of view and the pill
  // appears.
  await expect(page.locator('.jump-latest')).toBeVisible();
  await expect(page.locator('.msg-assistant .msg-text').last()).toContainText('word159');

  await page.locator('.jump-latest').click();
  expect(
    await thread.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
  ).toBeLessThanOrEqual(32);
  await expect(page.locator('.jump-latest')).toHaveCount(0);
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
