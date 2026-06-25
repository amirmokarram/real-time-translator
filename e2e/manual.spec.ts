import { test } from './fixtures';
import { startCapture } from './helpers';

// Hands-on session: launches the built app with the deterministic E2E seams
// (mock STT + echo translation/assist) and keeps it open so you can click around
// yourself. Because there's no real audio, feed transcripts from the app's
// DevTools console with the injected `window.__e2e` helper.
//
//   npm run e2e:manual
//
// Skipped during normal `playwright test` runs (only active when E2E_MANUAL is set).
test.describe('manual', () => {
  test.skip(!process.env['E2E_MANUAL'], 'Interactive session — run `npm run e2e:manual`.');

  test('hands-on session', async ({ page, electronApp }) => {
    test.setTimeout(0); // no timeout — the session lasts until you close it

    // Pop open DevTools so the console is right there for feeding transcripts.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.openDevTools({ mode: 'detach' });
    });

    // Expose console helpers that drive the MockSttStream (same 'e2e-stt' events
    // the automated specs dispatch). Available in the renderer DevTools console.
    await page.evaluate(() => {
      const fire = (detail: unknown) =>
        window.dispatchEvent(new CustomEvent('e2e-stt', { detail }));
      (window as unknown as { __e2e: unknown }).__e2e = {
        say: (text: string) => fire({ kind: 'final', text, endOfUtterance: true }),
        interim: (text: string) => fire({ kind: 'interim', text }),
        final: (text: string, end = false) => fire({ kind: 'final', text, endOfUtterance: end }),
        end: () => fire({ kind: 'utteranceEnd' }),
      };
      // eslint-disable-next-line no-console
      console.log(
        '%c[e2e] manual helpers ready',
        'color:#4ade80;font-weight:bold',
        '\n  __e2e.say("Hello world.")   → commit one sentence',
        '\n  __e2e.interim("typing…")    → live (un-committed) words',
        '\n  __e2e.final(text, end?)     → finalized chunk',
        '\n  __e2e.end()                 → end the utterance'
      );
    });

    // Select the (fake) microphone and start capturing so the pipeline is live.
    await startCapture(page);

    /* eslint-disable no-console */
    console.log('\n──────────────────────────────────────────────────────────────');
    console.log(' Manual E2E session is running. The app window is fully usable.');
    console.log(' Feed speech from the app DevTools console, e.g.:');
    console.log('   __e2e.say("Tell me about your experience.")');
    console.log(' Translations use the echo provider → "[fa] <text>".');
    console.log(' Close the app window (or press Resume in the Inspector) to end.');
    console.log('──────────────────────────────────────────────────────────────\n');
    /* eslint-enable no-console */

    // Hold the session open + bring up the Playwright Inspector.
    await page.pause();
  });
});
