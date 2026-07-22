---
name: e2e-testing
description: "Playwright E2E test setup — how it works, the deterministic seams, how to run it"
metadata: 
  node_type: memory
  type: project
  originSessionId: efb6c1f4-0f8c-44d0-8361-1634d470274d
  modified: 2026-07-22T14:42:41.795Z
---

Playwright E2E tests live in `e2e/` and drive the **built** Electron app + real Angular
renderer through the real IPC bridge. Started 2026-06-25 (first repo tests; Phase A done & passing).

**Run:** `npm run e2e` (builds prod + runs) · `npm run e2e:only` (skip build, fast iteration) ·
`npm run e2e:headed` · `npm run e2e:ui` (Playwright UI mode) · `npm run e2e:manual` (hands-on:
launches the deterministic app, opens DevTools, injects `window.__e2e.say()/interim()/final()/end()`
console helpers to feed transcripts by hand, `page.pause()` holds it open; `e2e/manual.spec.ts`,
skipped unless `E2E_MANUAL=1`). Config: [`playwright.config.ts`](../../../../D:/Claude-RealTimeTranslator/playwright.config.ts) (serial, 1 worker, Electron via `_electron`).
CI: `.github/workflows/e2e.yml` (ubuntu, `playwright install-deps chromium` + xvfb, build, `xvfb-run npm run e2e:only`, uploads HTML report). **Verified green on a real Actions run (18 passed, run `28164747036`).** Two CI-only gotchas hit on the way: (1) `npm ci` EUSAGE — Windows lock omitted Linux-only `@emnapi/*` optional deps, fixed by regenerating with `npx npm@11.13.0 install --package-lock-only`; (2) Electron's `@electron/get` postinstall truncates extraction on the runner — fixed by curl+unzip of the release zip (see [[gotchas-and-lessons]]). Don't reintroduce `node install.js` / `~/.cache/electron`.

**Determinism via guarded seams (inert in normal dev/prod):**
- STT/audio run in the **renderer**, so the transcript seam is renderer-side: `MockSttStream`
  (`src/app/core/services/stt/mock-stream.ts`), selected by `stt.provider === 'mock'`, driven by
  `window` `'e2e-stt'` CustomEvents. Audio uses Chromium fake-media launch flags + a microphone source.
- Translation/assist/dialogs run in **main**: `EchoProvider` (`[fa] <text>`, streams chunks) registered
  in `provider-registry.ts` only when `process.env.TRANSLATOR_E2E` is set; export dialog bypass → temp file.
  The EchoProvider also has a sentinel: input containing `__RESOLVED_PROMPT__` (`E2E_RESOLVED_PROMPT_SENTINEL`)
  makes it echo the *resolved* system prompt, so a test can assert `${SOURCE}`/`${TARGET}` token substitution.
- Per-test temp `userData` (`--user-data-dir`) seeded with `settings.json` (`e2e/seed-settings.ts`).

Harness: `e2e/fixtures.ts` (launch/teardown), `e2e/helpers.ts` (`feed`, `say`, `startCapture`, `getOverlayPage`).

Plan (phases A–D) all built 2026-06-25: A=core slice, B=settings+export, C=overlay+assist, D=GitHub Actions CI. **18 tests green locally.** Uncommitted as of session end. CI workflow unverified until pushed. See [[phase-status]], [[project-architecture]].

**Prompt-token + direction coverage (added 2026-06-26):** 4 tests added for the `${SOURCE}`/`${TARGET}` template-token feature and per-cell RTL (see [[translation-providers]]). In `settings.spec.ts`: editor shows the token template; a custom token prompt persists *verbatim* (un-substituted) to `settings.json`. In `translation-pipeline.spec.ts`: source-LTR/target-RTL `dir` attributes on the rendered text `<p>` only; and call-time token substitution via the EchoProvider sentinel (`From ${SOURCE} to ${TARGET}` → `From English to Persian`). **22 passed, 1 skipped (manual) locally.**

**Question Bank panel coverage (added 2026-07-16):** `e2e/question-bank.spec.ts` — 3 tests
for the assist panel's manual "Query From Q Bank" path (see [[question-bank]]): match →
`.bank-card` with the right title + "Found a prepared answer" message; digit-free question →
no-match branch streams a generated interview answer; no bank folder → `.quick-btn-bank`
hidden. **The echo-digit routing trick makes the LLM router deterministic:** EchoAssistProvider
echoes `routerUserMessage(q)` back, so a digit in the question parses as that manifest number
(fixture files in `e2e/bank-fixtures/` index alphabetically 1=closures, 2=DI, 3=event-loop),
and a digit-free question echoes the prompt's own "NONE" → `parseSelection` → []. Seed gained
`questionBank.folderPath` override (`seed-settings.ts`). **25 passed, 1 skipped locally.**
**Recording / Review / Notes coverage (added 2026-07-21):** `e2e/recording.spec.ts` — 11 tests
across Phases 7–9 (see [[phase-status]]). **The MediaRecorder here is REAL:** the harness already
launches with `--use-fake-device-for-media-stream`, so capture produces genuine (silent) WebM and
the assertions exercise the actual renderer → IPC → write-stream path, no stubs. New fixture
`recordingsDir` (temp folder, auto-injected into the seed whenever a test sets `seed.recording`);
`SeedOverrides.recording` defaults **enabled: false** so the other specs don't write meeting files
while exercising capture. Covered: non-empty correctly-named `.webm`; sidecar pairs with its audio
and has ordered offsets within `durationMs`; typed rows excluded; **recording failure doesn't stop
translation** (seeded folder path replaced with a *file* so mkdir fails); Review lists/plays/seeks;
**audio really loads over `rec://`** (asserts `readyState`-ish via `el.error === null` — catches a
CSP `media-src` or protocol-handler regression); missing sidecar still plays; notes persist and
**the merge leaves the transcript untouched**; notes reload from disk after navigating away;
session Ask carries the whole transcript, per-line Ask carries **only** that line (`toHaveText`, so
a leak of the whole meeting fails). **40 passed, 1 skipped locally.**

**Segmentation + Restore-Defaults coverage (added 2026-07-22): 52 passed, 1 skipped locally.**
`translation-pipeline.spec.ts` gained a `trailing-sentence commit` describe using the new
`SeedOverrides.sentenceMaxWaitMs` set to **60000** — the point is to push the idle safety timer out
of reach so the assertions can only be satisfied by the punctuation rules, never by the timer firing
behind them (the earlier default of 1000 would have made the negative case pass for the wrong
reason). Covers: a mid-utterance `final` with no `endOfUtterance` commits immediately; an
abbreviation tail is held and the sentence stays whole; numbers and version strings still split.
`settings.spec.ts` gained 3 reset tests — a panel reset re-hydrates its inputs *and* leaves the
other STT panel alone, the Engine panel resets Endpointing (the regression Amir found) while keeping
the API key, and restore-all crosses panels while both API keys survive. **Selector trap:** Playwright's
`hasText` is substring **and case-insensitive**, so `.field-group` filtered by `'Model'` matched three
groups whose *hints* mention "model" — match the label element exactly
(`filter({ has: locator('label.field-label', { hasText: /^Model$/ }) })`).

**Lesson from the post-live-test fixes (2026-07-21): verify a regression test FAILS without its
fix.** Two of these tests were worthless until checked. The first seek test asserted only
`currentTime > 0` and passed against the broken build; a rewrite still passed both ways because a
short test recording buffers whole and seeks fine without range support — the failure only appears
on a long file. It was moved down to the level that actually broke: the spec calls the `rec://`
handler through `electronApp.evaluate(({net}) => net.fetch(url, {headers:{Range:'bytes=10-19'}}))`
and asserts `206`, the exact `Content-Range`, `Accept-Ranges`, `Content-Type` and a 10-byte body.
(A third attempt at the fails-without-fix check was itself invalid: the temporary edit didn't
compile, so `electron:compile` aborted and the test silently ran against the previous good build —
**check the compile succeeded before trusting a negative result**.) The offset-clustering and
navigate-away tests were both confirmed to fail with their fix reverted. Also: a range test that
stops capture immediately gets a **zero-byte file**, and a range of an empty file proves nothing —
wait ~1.2 s for a chunk first, as the other recording tests do.

**Known pre-existing flakes (NOT recording-related), both in the prompt-token area:**
`translation-pipeline.spec.ts` › "resolves ${SOURCE}/${TARGET} tokens…" and `settings.spec.ts` ›
"a custom prompt with tokens persists verbatim". Both fail intermittently under full-suite load and
pass on rerun / in isolation. They predate the recording work — leave them unless they are the task,
but note they may be the same underlying settings-save timing issue and worth one investigation.

**The recording specs' own "notes persist…" flake was a REAL BUG, not a bad test** (2026-07-21):
`EPERM` on the sidecar's temp→rename under Windows, losing the note ~30% of the time. Two confident
test-level theories were both wrong and neither changed the 4/12 failure rate. See
[[gotchas-and-lessons]]. **Reach for `--repeat-each N` to make an intermittent failure reproducible,
then dump the app's own state on failure (error banners, signal-derived classes, the file on disk)
rather than reasoning from the assertion alone.**

**Gotcha that cost real time:** `npx playwright test` / `npm run e2e:only` do **NOT rebuild** the
renderer — only `npm run e2e` does (`electron:build && playwright test`). Debugging a renderer
change against a stale `dist/` bundle looks exactly like the feature being broken. Rebuild first.

Still uncovered by e2e (deliberate seams or just not written): real STT/translation/assist
providers, language-pair switching UI, latency knobs, history length, assist prompt editors,
`bank:open` card click (would launch the OS file handler). **Recording-specific gaps:** the
`mix`/`separate` mic modes are inert under test (the fake device only offers a *microphone*, and
mic modes only engage for **system audio**), and seeking is only proven on a few seconds of
silence — not on a long cue-less WebM.
