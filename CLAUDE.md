# Real-Time Translator — Project Context

Cross-platform desktop app for **real-time translation of system audio** (meetings, videos, calls). The user (Amir) listens to audio in one language and reads a live translation in another. The **language pair is fully user-configurable** (Settings → Languages) — any supported source→target pair from a curated catalog.

> Full detail lives in [`docs/memory/`](docs/memory/). This file is the auto-loaded summary — it travels with the repo, so project context survives a machine/OS change. The canonical copies I auto-read also live in `~/.claude/projects/D--Claude-RealTimeTranslator/memory/`; keep the two in sync (treat `~/.claude` as source of truth I edit, then copy here before committing).

## Stack
- **Angular 21** (standalone components, signals, `@if`/`@for`) — renderer
- **Electron 42** — desktop shell
- 2 switchable streaming STT providers: **DeepGram** (cloud, WebSocket) and **Whisper** (local, WhisperLive WebSocket) — renderer-side `ISttStream` strategy
- 7 switchable translation providers: Claude, Google, DeepL, Microsoft, OpenAI, LibreTranslate, Ollama (local)
- Configurable source/target languages from a curated catalog — **single source of truth `src/app/core/models/languages.json`** (renderer imports it; the build copies it to `dist-electron/config/` so the main process reads it at runtime via `electron/languages.ts`); per-cell text direction/font driven by each language's `rtl` flag (Vazirmatn for RTL)
- Dark theme; Vazirmatn font for Persian/RTL text

## Architecture (key rules)
- **Translation & assist API keys + calls stay in the Electron MAIN process** — never move them to Angular services.
- **STT streaming is the exception: it runs in the RENDERER** (browser `WebSocket`, like DeepGram's subprotocol-token auth). Both providers live behind a renderer-side `ISttStream` strategy (`src/app/core/services/stt/`); `TranscriptionService` owns sentence segmentation and picks the strategy from `stt.provider`. Whisper uses a local WhisperLive WS — see [`docs/memory/whisper-stt-provider.md`](docs/memory/whisper-stt-provider.md).
- Renderer ↔ main via secure IPC bridge (`contextBridge` + `electron/preload.ts`, typed `ElectronAPI`).
- Router uses **HashLocationStrategy** (required for `file://` prod load; also how the overlay targets `#/overlay`).
- Translation events (`translation:source`/`:chunk`/`:complete`) are **broadcast to all windows** so the overlay mirrors the main window for free.
- Settings persist to `userData/settings.json`. The `AppSettings` schema is defined once in `shared/app-settings.d.ts` (shared across both TS contexts); defaults live in `electron/config/default-settings.json`.
- TS isolation: `tsconfig.app.json` (renderer, browser types) vs `tsconfig.electron.json` (main, CommonJS/Node).

## Build & run (Windows / PowerShell)
- `npm run electron:dev` — dev (ng serve :4200 + Electron hot-reload)
- `npm run electron:compile` — compile Electron TS only → `dist-electron/`
- `npm run electron:dist:win` — package Windows installer
- After any **main-process** change: recompile Electron + restart.

## Critical gotchas (see docs/memory/gotchas-and-lessons.md)
- **Web Speech API does NOT work in Electron** (no Google keys → always `error: network`). Use DeepGram.
- **Desktop audio capture needs a video track** — request both in `getUserMedia`, discard the video track.
- **`:host { display:flex; height:100% }`** required on full-height components or flex children grow unbounded.
- **LibreTranslate** needs explicit `Content-Length` (else "socket hang up"); `libretranslate.com` is paid — run local Docker `--load-only en,fa`.
- **CSP must include `wss:`** for streaming providers.

## Status
Phases 1–5 done: capture → STT → translate → live dual-pane display, **overlay mode**, **history export (TXT/SRT)**, **assist mode**. **Question Bank** (2026-07-16): assist-panel "Query From Q Bank" — an LLM router picks which prepared markdown Q&A file (local folder, Settings → General) answers the selected question; match → open the file, no match → generated interview-ready answer (prompt: live-read file → Settings editor → built-in default; see `docs/memory/question-bank.md`). **System tray + close-to-tray** (2026-07-16): tray menu (show/hide window, start/stop capture, toggle overlay, quit); X hides to tray while translation keeps running (`settings.tray.closeToTray`, Settings → General toggle); capture toggle reaches the renderer via `command:toggle-capture` → `CommandService`. **Global hotkeys** (2026-07-16): `electron/hotkeys.ts` registers `settings.hotkeys` (`Ctrl+Alt+C` capture, `Ctrl+Alt+O` overlay, `Ctrl+Alt+H` show/hide; `''` = disabled) system-wide, re-applied live on every settings save; Settings → Hotkeys panel records combos via keydown (`event.code`); nothing registers under `TRANSLATOR_E2E`. **Roadmap complete — no planned features remain.** Post-roadmap polish (2026-07-17): assist stop-generation (requestId-tagged `assist:chunk`/`assist:complete` events) + copy-answer; persistent audio-source selection; **always-on-top** main window (`settings.window.alwaysOnTop` behind three synced controls — header pin, tray checkbox, Settings → General — one `toggleAlwaysOnTop()` path in main broadcasts `window:always-on-top`). See `docs/memory/phase-status.md`.

## Working with Amir
Plan first, then build phase-by-phase (he approves each, then says "next"). He tests each phase and reports precise bugs — trust them, verify the real cause. Commit only when asked. Shell is **PowerShell** (the Bash tool has quoting issues here).
