# Real-Time Translator — Project Context

Cross-platform desktop app for **real-time translation of system audio** (meetings, videos, calls). The user (Amir) listens to audio in one language and reads a live translation in another. The **language pair is user-configurable** (Settings → Languages); it defaults to English→Persian (Farsi) and that remains the primary use case.

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
Phases 1–4 mostly done: capture → STT → translate → live dual-pane display, **overlay mode**, **history export (TXT/SRT)**. Remaining: system tray + global hotkeys, and packaging the installer. See `docs/memory/phase-status.md`.

## Working with Amir
Plan first, then build phase-by-phase (he approves each, then says "next"). He tests each phase and reports precise bugs — trust them, verify the real cause. Commit only when asked. Shell is **PowerShell** (the Bash tool has quoting issues here).
