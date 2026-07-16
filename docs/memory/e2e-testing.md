---
name: e2e-testing
description: "Playwright E2E test setup — how it works, the deterministic seams, how to run it"
metadata: 
  node_type: memory
  type: project
  originSessionId: efb6c1f4-0f8c-44d0-8361-1634d470274d
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
Still uncovered by e2e (deliberate seams or just not written): real STT/translation/assist
providers, language-pair switching UI, latency knobs, history length, assist prompt editors,
`bank:open` card click (would launch the OS file handler).
