import * as fs from 'fs/promises';
import * as path from 'path';
import { test, expect } from './fixtures';
import { feed, startCapture, say } from './helpers';

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

  test('sentences from one utterance get their own offsets, not a shared one', async ({
    page,
    recordingsDir,
  }) => {
    await startCapture(page);

    // Two finalized fragments inside ONE utterance, seconds apart. Both sentences
    // are peeled from the same buffer — the bug was that they then shared the
    // timestamp of the first fragment, so a burst of lines all pointed at the
    // same instant in the recording and the highlight sat still while the audio
    // moved on.
    await feed(page, { kind: 'final', text: 'First sentence.', endOfUtterance: false });
    await page.waitForTimeout(1500);
    await feed(page, { kind: 'final', text: 'Second sentence.', endOfUtterance: true });
    await expect(page.locator('.history-row')).toHaveCount(2);

    await page.click('button.capture-btn');
    await expect.poll(() => sidecars(recordingsDir)).toHaveLength(1);

    const [json] = await sidecars(recordingsDir);
    const transcript = JSON.parse(
      await fs.readFile(path.join(recordingsDir, json), 'utf-8')
    );

    expect(transcript.entries).toHaveLength(2);
    const [first, second] = transcript.entries;
    expect(second.offsetMs - first.offsetMs).toBeGreaterThan(1000);
  });

  test('a note belongs to one row, even when rows share a timestamp', async ({ page }) => {
    // Two sentences inside ONE finalized fragment: the mock backend reports no
    // word timings, so both legitimately fall at the same moment in the audio.
    // Note state used to be keyed by that timestamp, so the pair shared a note
    // and opening one editor opened both.
    await startCapture(page);
    await feed(page, { kind: 'final', text: 'One two three. Four five six.', endOfUtterance: true });
    await expect(page.locator('.history-row')).toHaveCount(2);
    await page.click('button.capture-btn');

    await page.getByRole('link', { name: 'Review' }).click();
    const rows = page.locator('.transcript-row');
    await expect(rows).toHaveCount(2);

    // Both rows really do sit at the same offset — the collision is real.
    const offsets = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.transcript-row .tcell-meta')).map(
        (el) => el.textContent!.trim()
      )
    );
    expect(offsets[0]).toBe(offsets[1]);

    // Opening the first row's editor must not open the second's.
    await rows.nth(0).locator('.note-btn').click();
    const editor = page.locator('.line-note .note-input');
    await expect(editor).toHaveCount(1);
    await expect(editor).toBeVisible();

    await editor.fill('Only about the first line.');
    await editor.blur();

    // …and the note stays on that row alone.
    await expect(page.locator('.line-note')).toHaveCount(1);
    await expect(page.locator('.transcript-row.noted')).toHaveCount(1);
    await expect(rows.nth(0)).toHaveClass(/noted/);
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

  test('navigating away mid-capture still files the transcript', async ({
    page,
    recordingsDir,
  }) => {
    await startCapture(page);
    await say(page, 'Said before leaving.');
    await expect(page.locator('.history-row')).toHaveCount(1);

    // Leave without pressing Stop: the route change destroys the translator,
    // which stops capture — the session must still be finished.
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.locator('.settings-sidebar')).toBeVisible();

    await expect.poll(() => sidecars(recordingsDir)).toHaveLength(1);
    const [json] = await sidecars(recordingsDir);
    const transcript = JSON.parse(
      await fs.readFile(path.join(recordingsDir, json), 'utf-8')
    );
    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0].source).toBe('Said before leaving.');
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

  // Seeking a streamed WebM only works if the rec:// handler answers byte ranges:
  // the file has no duration header, so range support is the only thing that lets
  // the player move past what it has already buffered. Asserted at the protocol
  // level because a short test recording buffers whole and would seek fine either
  // way — the failure only shows up on a real, long meeting.
  test('the rec:// handler answers byte-range requests with 206', async ({
    page,
    electronApp,
  }) => {
    await startCapture(page);
    await say(page, 'Ranged.');
    // Give the recorder time to hand over a chunk — stopping immediately can
    // leave a zero-byte file, and a range of an empty file proves nothing.
    await page.waitForTimeout(1200);
    await page.click('button.capture-btn');

    await page.getByRole('link', { name: 'Review' }).click();
    await expect(page.locator('.session-item')).toHaveCount(1);

    const url = await page.evaluate(
      () => (document.querySelector('audio') as HTMLAudioElement).src
    );

    const res = await electronApp.evaluate(async ({ net }, target) => {
      const full = await net.fetch(target);
      const size = Number(full.headers.get('Content-Length'));
      const partial = await net.fetch(target, { headers: { Range: 'bytes=10-19' } });
      const body = await partial.arrayBuffer();
      return {
        size,
        acceptRanges: full.headers.get('Accept-Ranges'),
        contentType: full.headers.get('Content-Type'),
        status: partial.status,
        contentRange: partial.headers.get('Content-Range'),
        bytes: body.byteLength,
      };
    }, url);

    expect(res.size).toBeGreaterThan(20);
    expect(res.acceptRanges).toBe('bytes');
    expect(res.contentType).toBe('audio/webm');
    expect(res.status).toBe(206);
    expect(res.contentRange).toBe(`bytes 10-19/${res.size}`);
    expect(res.bytes).toBe(10);
  });

  test('clicking a late line seeks to it instead of snapping back to the start', async ({
    page,
  }) => {
    // Deliberately long enough that the target is past what the player buffers
    // up front: the bug was that without byte-range support the media could not
    // seek beyond its buffer, so every click reset the audio to 0.
    await startCapture(page);
    for (let i = 0; i < 5; i++) {
      await say(page, `Line ${i}.`);
      await page.waitForTimeout(2000);
    }
    await page.click('button.capture-btn');

    await page.getByRole('link', { name: 'Review' }).click();
    await expect(page.locator('.transcript-row')).toHaveCount(5);

    // The last line sits several seconds in.
    const rows = page.locator('.transcript-row');
    const targetMs = await page.evaluate(() => {
      const el = document.querySelectorAll('.transcript-row .tcell-meta');
      const text = el[el.length - 1].textContent!.trim(); // "m:ss"
      const [m, s] = text.split(':').map(Number);
      return (m * 60 + s) * 1000;
    });
    expect(targetMs).toBeGreaterThan(4000);

    await rows.last().click();

    // Lands on the line, not back at zero.
    await expect
      .poll(
        () =>
          page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).currentTime),
        { timeout: 8000 }
      )
      .toBeGreaterThan(targetMs / 1000 - 1.5);
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

    const [json] = await sidecars(recordingsDir);
    const read = async () =>
      JSON.parse(await fs.readFile(path.join(recordingsDir, json), 'utf-8'));

    // A note on the whole session — wait for it to reach disk before writing the
    // next, so the two saves can't interleave under load and drop one.
    await page.fill('.session-note-input', 'Follow up on the pricing question.');
    await page.locator('.session-note-input').blur();
    await expect.poll(async () => (await read()).notes?.session ?? '').toBe(
      'Follow up on the pricing question.'
    );

    // …and one pinned to the second line. Typed with real key events rather than
    // fill(): the editor is created the moment its row's button is clicked, and a
    // one-shot value set can land before Angular's own input listener is live —
    // leaving the text visible in the DOM but never seen by ngModel.
    await page.locator('.transcript-row').nth(1).locator('.note-btn').click();
    const lineNote = page.locator('.line-note .note-input');
    await expect(lineNote).toBeVisible();
    await lineNote.pressSequentially('They disagreed here.');
    await lineNote.blur();
    await expect.poll(async () => (await read()).notes?.lines?.length ?? 0).toBe(1);
    // A save that failed reports itself — the note must not be silently lost.
    await expect(page.locator('.error-banner')).toHaveCount(0);

    const transcript = await read();
    expect(transcript.notes.session).toBe('Follow up on the pricing question.');
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

// 'separate' mode can't be produced under test — the fake media device only
// offers a microphone, and the mic modes only engage for system audio. The pair
// of files it writes is easy to stage directly, which is what matters here: that
// a two-track session lists as ONE session with a track toggle, not as a session
// plus a transcript-less duplicate.
test.describe('two-track (separate mode) sessions', () => {
  test.use({ seed: { recording: { enabled: false } } });

  test('a system/mic pair lists as one session with a track toggle', async ({
    page,
    recordingsDir,
  }) => {
    const stem = 'meeting-2026-07-21-0900';
    await fs.writeFile(path.join(recordingsDir, `${stem}-system.webm`), 'system-audio');
    await fs.writeFile(path.join(recordingsDir, `${stem}-mic.webm`), 'mic-audio');
    await fs.writeFile(
      path.join(recordingsDir, `${stem}-system.json`),
      JSON.stringify({
        startedAt: new Date().toISOString(),
        durationMs: 60000,
        languages: { source: 'en', target: 'fa' },
        entries: [{ offsetMs: 0, source: 'Staged line.', target: '[fa] Staged line.', provider: 'echo' }],
      })
    );

    await page.getByRole('link', { name: 'Review' }).click();

    // One entry, not two — the mic file rides along instead of listing itself.
    await expect(page.locator('.session-item')).toHaveCount(1);
    await expect(page.locator('.session-meta')).not.toContainText('no transcript');
    await expect(page.locator('.transcript-row')).toHaveCount(1);

    // Switching track swaps the audio source and keeps the transcript.
    await expect(page.locator('.track-toggle')).toBeVisible();
    await page.locator('.track-btn', { hasText: 'Mic' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).src)
      )
      .toContain('-mic.webm');
    await expect(page.locator('.transcript-row')).toHaveCount(1);
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
