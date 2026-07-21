import * as fs from 'fs/promises';
import * as path from 'path';
import { test, expect } from './fixtures';
import { startCapture, say } from './helpers';

// The harness launches Chromium with --use-fake-device-for-media-stream, so the
// MediaRecorder here is real and produces genuine (silent) WebM — these assertions
// exercise the actual renderer → IPC → write-stream path, not a stub.
//
// Note the capture source is a microphone (the only one the fake device offers),
// so the mic-mixing modes are inert by design: they only engage for system audio.
// 'mix' and 'separate' therefore need a live desktop-loopback session to verify.

async function webmFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  return entries.filter((f) => f.endsWith('.webm'));
}

async function sidecars(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  return entries.filter((f) => f.endsWith('.json'));
}

test.describe('recording enabled', () => {
  test.use({ seed: { recording: { enabled: true } } });

  test('a capture session writes a non-empty audio file', async ({ page, recordingsDir }) => {
    await startCapture(page);
    await expect(page.locator('.rec-badge')).toBeVisible();

    await say(page, 'Recording this meeting.');
    await expect(page.locator('.history-row')).toHaveCount(1);

    // Give the recorder a beat to hand over at least one chunk, then close the file.
    await page.waitForTimeout(1200);
    await page.click('button.capture-btn');
    await expect(page.locator('.rec-badge')).toHaveCount(0);

    await expect.poll(() => webmFiles(recordingsDir)).toHaveLength(1);

    const [file] = await webmFiles(recordingsDir);
    const stat = await fs.stat(path.join(recordingsDir, file));
    expect(stat.size).toBeGreaterThan(0);
    expect(file).toMatch(/^meeting-\d{4}-\d{2}-\d{2}-\d{4}\.webm$/);
  });

  test('the transcript sidecar lands beside the audio with recording-relative offsets', async ({
    page,
    recordingsDir,
  }) => {
    await startCapture(page);

    await say(page, 'First line.');
    await page.waitForTimeout(600);
    await say(page, 'Second line.');
    await expect(page.locator('.history-row')).toHaveCount(2);

    await page.click('button.capture-btn');
    await expect.poll(() => sidecars(recordingsDir)).toHaveLength(1);

    const [audio] = await webmFiles(recordingsDir);
    const [json] = await sidecars(recordingsDir);
    // Same basename as the audio, so a session is one obvious pair of files.
    expect(json).toBe(audio.replace(/\.webm$/, '.json'));

    const transcript = JSON.parse(
      await fs.readFile(path.join(recordingsDir, json), 'utf-8')
    );

    expect(transcript.languages).toEqual({ source: 'en', target: 'fa' });
    expect(transcript.durationMs).toBeGreaterThan(0);
    expect(Date.parse(transcript.startedAt)).not.toBeNaN();

    expect(transcript.entries).toHaveLength(2);
    expect(transcript.entries[0].source).toBe('First line.');
    expect(transcript.entries[0].target).toBe('[fa] First line.');
    expect(transcript.entries[1].source).toBe('Second line.');

    // Offsets are relative to the recording start, in order, and inside the
    // session — the whole point is that a player can seek to them.
    expect(transcript.entries[0].offsetMs).toBeGreaterThanOrEqual(0);
    expect(transcript.entries[1].offsetMs).toBeGreaterThan(transcript.entries[0].offsetMs);
    for (const entry of transcript.entries) {
      expect(entry.offsetMs).toBeLessThanOrEqual(transcript.durationMs);
    }
  });

  test('typed rows are left out of the sidecar — they have no place in the audio', async ({
    page,
    recordingsDir,
  }) => {
    await startCapture(page);
    await say(page, 'Spoken line.');
    await page.click('button.capture-btn');

    // Typed after capture stopped: a history row, but nothing to seek to.
    await page.fill('textarea.text-input', 'Typed line.');
    await page.click('button.translate-btn');
    await expect(page.locator('.history-row')).toHaveCount(2);

    await expect.poll(() => sidecars(recordingsDir)).toHaveLength(1);
    const [json] = await sidecars(recordingsDir);
    const transcript = JSON.parse(
      await fs.readFile(path.join(recordingsDir, json), 'utf-8')
    );

    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0].source).toBe('Spoken line.');
  });

  test('recording failures do not stop translation', async ({ page, recordingsDir }) => {
    // Point the recorder at a path that cannot be created, then confirm the
    // pipeline still commits rows — recording is the secondary job.
    await fs.rm(recordingsDir, { recursive: true, force: true });
    await fs.writeFile(recordingsDir, 'not a directory', 'utf-8');

    await startCapture(page);
    await say(page, 'Translation still works.');

    const row = page.locator('.history-row').first();
    await expect(row.locator('.hcell-en .hcell-text')).toHaveText('Translation still works.');
    await expect(row.locator('.hcell-fa .target-text')).toHaveText('[fa] Translation still works.');
  });
});

test.describe('review view', () => {
  test.use({ seed: { recording: { enabled: true } } });

  test('lists a recorded session, plays it, and seeks from a transcript line', async ({ page }) => {
    await startCapture(page);
    await say(page, 'First line.');
    await page.waitForTimeout(600);
    await say(page, 'Second line.');
    await expect(page.locator('.history-row')).toHaveCount(2);
    await page.click('button.capture-btn');

    await page.getByRole('link', { name: 'Review' }).click();
    await expect(page.locator('.session-item')).toHaveCount(1);

    // Transcript rows render from the sidecar, newest session selected by default.
    const rows = page.locator('.transcript-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.tcell-text').first()).toHaveText('First line.');

    // The audio actually loads over rec:// — this is what the CSP media-src and
    // the protocol handler exist for, and a regression there shows up as an
    // element that never reaches readyState > 0.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.querySelector('audio') as HTMLAudioElement | null;
            return el ? { src: el.src.startsWith('rec://'), error: el.error?.code ?? null } : null;
          }),
        { timeout: 5000 }
      )
      .toEqual({ src: true, error: null });

    // Clicking a line seeks the player to that line's offset.
    await rows.nth(1).click();
    const offset = await page.evaluate(() => {
      const el = document.querySelector('audio') as HTMLAudioElement;
      return el.currentTime;
    });
    expect(offset).toBeGreaterThan(0);
  });

  test('notes persist into the sidecar without disturbing the transcript', async ({
    page,
    recordingsDir,
  }) => {
    await startCapture(page);
    await say(page, 'First line.');
    await page.waitForTimeout(600);
    await say(page, 'Second line.');
    await expect(page.locator('.history-row')).toHaveCount(2);
    await page.click('button.capture-btn');

    await page.getByRole('link', { name: 'Review' }).click();
    await expect(page.locator('.transcript-row')).toHaveCount(2);

    // A note on the whole session…
    await page.fill('.session-note-input', 'Follow up on the pricing question.');
    await page.locator('.session-note-input').blur();

    // …and one pinned to the second line.
    await page.locator('.transcript-row').nth(1).locator('.note-btn').click();
    await page.fill('.line-note .note-input', 'They disagreed here.');
    await page.locator('.line-note .note-input').blur();

    const [json] = await sidecars(recordingsDir);
    const read = async () =>
      JSON.parse(await fs.readFile(path.join(recordingsDir, json), 'utf-8'));

    await expect.poll(async () => (await read()).notes?.session).toBe(
      'Follow up on the pricing question.'
    );

    const transcript = await read();
    expect(transcript.notes.lines).toHaveLength(1);
    expect(transcript.notes.lines[0].text).toBe('They disagreed here.');
    // Pinned to the line it was written on.
    expect(transcript.notes.lines[0].offsetMs).toBe(transcript.entries[1].offsetMs);

    // The merge must leave everything else exactly as it was.
    expect(transcript.entries).toHaveLength(2);
    expect(transcript.entries[0].source).toBe('First line.');
    expect(transcript.entries[1].source).toBe('Second line.');
    expect(transcript.durationMs).toBeGreaterThan(0);
    expect(transcript.languages).toEqual({ source: 'en', target: 'fa' });
  });

  test('saved notes reload with the session', async ({ page }) => {
    await startCapture(page);
    await say(page, 'Only line.');
    await page.click('button.capture-btn');

    await page.getByRole('link', { name: 'Review' }).click();
    await page.fill('.session-note-input', 'Remember this.');
    await page.locator('.session-note-input').blur();
    await expect(page.locator('.notes-status.saved')).toBeVisible();

    // Leave and come back — the notes come from disk, not component state.
    await page.getByRole('link', { name: 'Translator' }).click();
    await page.getByRole('link', { name: 'Review' }).click();
    await expect(page.locator('.session-note-input')).toHaveValue('Remember this.');
  });

  test('Ask sends the whole session transcript to the assistant', async ({ page }) => {
    await startCapture(page);
    await say(page, 'First line.');
    await say(page, 'Second line.');
    await expect(page.locator('.history-row')).toHaveCount(2);
    await page.click('button.capture-btn');

    await page.getByRole('link', { name: 'Review' }).click();
    await expect(page.locator('.transcript-row')).toHaveCount(2);

    await page.locator('.player-bar .ask-btn').click();
    await expect(page.locator('.assist-panel')).toBeVisible();

    // The context is the session's source lines — expand the chip and check.
    await page.locator('.context-toggle').click();
    const context = page.locator('.context-body');
    await expect(context).toContainText('First line.');
    await expect(context).toContainText('Second line.');

    await page.locator('.assist-textarea').fill('summarize this');
    await page.locator('.assist-send').click();
    await expect(page.locator('.msg-assistant .msg-text').last()).toContainText('Echo:');
  });

  test('a line can be asked about on its own', async ({ page }) => {
    await startCapture(page);
    await say(page, 'First line.');
    await say(page, 'Second line.');
    await expect(page.locator('.history-row')).toHaveCount(2);
    await page.click('button.capture-btn');

    await page.getByRole('link', { name: 'Review' }).click();
    await page.locator('.transcript-row').nth(1).locator('.row-btn').first().click();

    await expect(page.locator('.assist-panel')).toBeVisible();
    await page.locator('.context-toggle').click();
    // Only the line that was clicked — not the rest of the meeting.
    await expect(page.locator('.context-body')).toHaveText('Second line.');
  });

  test('a session with no transcript still offers its audio', async ({ page, recordingsDir }) => {
    await startCapture(page);
    await say(page, 'Only audio.');
    await page.click('button.capture-btn');

    // Drop the sidecar to mimic a session interrupted before it was written.
    await expect.poll(() => sidecars(recordingsDir)).toHaveLength(1);
    const [json] = await sidecars(recordingsDir);
    await fs.rm(path.join(recordingsDir, json));

    await page.getByRole('link', { name: 'Review' }).click();
    await expect(page.locator('.session-item')).toHaveCount(1);
    await expect(page.locator('.session-meta')).toContainText('no transcript');
    await expect(page.locator('.transcript-row')).toHaveCount(0);
    await expect(page.locator('.player-bar')).toBeVisible();
  });
});

test.describe('recording disabled', () => {
  test.use({ seed: { recording: { enabled: false } } });

  test('capture writes no file and shows no indicator', async ({ page, recordingsDir }) => {
    await startCapture(page);
    await expect(page.locator('.rec-badge')).toHaveCount(0);

    await say(page, 'Not recorded.');
    await expect(page.locator('.history-row')).toHaveCount(1);
    await page.click('button.capture-btn');

    expect(await webmFiles(recordingsDir)).toHaveLength(0);
  });
});
