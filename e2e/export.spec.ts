import * as fs from 'fs/promises';
import { test, expect } from './fixtures';
import { startCapture, say } from './helpers';

test.beforeEach(async ({ page }) => {
  await startCapture(page);
  await say(page, 'Hello world.');
  await say(page, 'Second line.');
  await expect(page.locator('.history-row')).toHaveCount(2);
});

test('exports history as a TXT transcript', async ({ page, exportPath }) => {
  await page.getByTitle('Export history').click();
  await page.locator('.export-option', { hasText: 'Text' }).click();

  const content = await readFileEventually(exportPath);
  expect(content).toContain('Real-Time Translation Transcript');
  expect(content).toContain('Segments: 2');
  expect(content).toContain('EN: Hello world.');
  expect(content).toContain('FA: [fa] Hello world.');
  expect(content).toContain('EN: Second line.');
  expect(content).toContain('FA: [fa] Second line.');
});

test('exports history as SRT subtitles with indices and timecodes', async ({ page, exportPath }) => {
  await page.getByTitle('Export history').click();
  await page.locator('.export-option', { hasText: 'Subtitles' }).click();

  const content = await readFileEventually(exportPath);
  // First cue: index 1, a 00:00:00,000 start timecode, then EN + FA lines.
  expect(content).toMatch(/^1\r?\n00:00:00,000 --> \d{2}:\d{2}:\d{2},\d{3}/);
  expect(content).toContain('Hello world.');
  expect(content).toContain('[fa] Hello world.');
  expect(content).toMatch(/\n2\r?\n/); // second cue index present
  expect(content).toContain('Second line.');
});

// Poll the file until the expected content has been written by the main process.
async function readFileEventually(path: string): Promise<string> {
  let content = '';
  await expect
    .poll(async () => {
      try {
        content = await fs.readFile(path, 'utf-8');
      } catch {
        content = '';
      }
      return content.length;
    }, { message: 'export file written' })
    .toBeGreaterThan(0);
  return content;
}
