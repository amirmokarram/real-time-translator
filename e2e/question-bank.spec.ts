import * as path from 'path';
import { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { startCapture, say } from './helpers';

// Question Bank (Phase 1) — the assist panel's manual "Query From Q Bank" path.
// The echo assist provider makes the LLM router deterministic: it echoes the
// router's user message back, so any digit in the selected question is parsed as
// that manifest number (files index alphabetically: 1 = closures,
// 2 = dependency-injection, 3 = event-loop), and a digit-free question echoes the
// prompt's own "NONE" → the no-match branch.
const BANK_DIR = path.join(__dirname, 'bank-fixtures');

// Say a sentence, select its history row, and open the assist panel via Ask.
async function askAbout(page: Page, sentence: string): Promise<void> {
  await startCapture(page);
  await say(page, sentence);
  await page.locator('.history-row').first().click();
  await page.locator('.selection-bar .ask-btn').click();
  await expect(page.locator('.assist-panel')).toBeVisible();
}

test.describe('Query From Q Bank (bank configured)', () => {
  test.use({ seed: { questionBank: { folderPath: BANK_DIR } } });

  test('routes the selected question to the matching prepared file', async ({ page }) => {
    await askAbout(page, 'Can you explain topic number 2 in detail?');
    await page.locator('.quick-btn-bank').click();

    // Match → clickable file card + a "found it" thread message; no generation.
    await expect(page.locator('.bank-card')).toHaveCount(1);
    await expect(page.locator('.bank-card-title')).toHaveText('Dependency Injection');
    await expect(page.locator('.msg-assistant').last()).toContainText('Found a prepared answer');
  });

  test('no match generates an interview-ready answer instead', async ({ page }) => {
    // No digits → the echoed router prompt reads as NONE → the no-match branch.
    await askAbout(page, 'Please walk me through your proudest project?');
    await page.locator('.quick-btn-bank').click();

    await expect(page.locator('.bank-card')).toHaveCount(0);
    // The generated answer streams through the normal assist path (echo provider).
    await expect(page.locator('.msg-assistant').last()).toContainText(
      'Echo: Answer the interviewer’s question'
    );
  });
});

test.describe('Query From Q Bank (no bank configured)', () => {
  test('the quick action is hidden without a bank folder', async ({ page }) => {
    await askAbout(page, 'Can you explain topic number 2 in detail?');
    // Other quick actions render; the bank one is gated on a configured folder.
    await expect(page.locator('.quick-btn').first()).toBeVisible();
    await expect(page.locator('.quick-btn-bank')).toHaveCount(0);
  });
});
