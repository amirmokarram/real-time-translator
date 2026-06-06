---
name: phase-status
description: "Build phase tracker for the Real-Time Translator — what's done and what's next"
metadata: 
  node_type: memory
  type: project
  originSessionId: d1468163-6e3b-4140-8e02-a0b3d8eb0ee3
---

Status tracker. Durable engineering lessons are in [[gotchas-and-lessons]]; architecture in [[project-architecture]].

**DONE (all 2026-06-04):**
- **Phase 1 — Scaffold:** Angular 21 + Electron 42 wired; IPC bridge (contextBridge/preload, typed `ElectronAPI`); 6 translation providers; settings persisted to `userData/settings.json`; dark dual-pane UI.
- **Phase 2 — System audio capture:** `AudioService` does `getUserMedia` desktop-loopback in renderer; `AudioContext`+`AnalyserNode` RMS level meter. (See gotchas: video-track discard.)
  - **Source picker (2026-06-04):** the audio-bar ComboBox now offers **System Audio** + **each microphone** (not per-screen rows). `AudioSource` has a `kind` ('system'|'microphone'); ids are prefixed `system:<screenId>` / `mic:<deviceId>`. `getSources()` (main) returns one System Audio entry; mics enumerated in renderer via `enumerateDevices` (with a getUserMedia probe so labels populate); `acquireStream()` branches on `kind`. NOTE: `settings.audio.selectedSourceId` is still never written/read — selection does not persist across restarts (pre-existing gap, offered as follow-up).
- **Phase 3 — STT (DeepGram):** `TranscriptionService` streams via DeepGram WebSocket; `MediaRecorder` WebM/Opus chunks; auto-reconnect. Settings has DeepGram key + Test Connection. (Free tier 12k min/yr, key at console.deepgram.com.)
  - **Sentence segmentation (2026-06-06):** DeepGram segments on *silence*, not grammar, so naive per-`is_final` commits fragmented sentences across rows. Now: buffer `is_final` fragments in `pendingFinal`, peel off complete sentences (`.!?`) via `drainSentences()` the moment the next begins → one row = one grammatical sentence, committed in real time while listening continues. Trailing partial joins the next utterance or commits via a 4s idle timer / on stop. `endpointing=800` (brief clause pauses don't split); `utterance_end_ms=1000` UtteranceEnd backstop. **Coalescing gotcha:** committed sentences go through a `pendingSentences` queue + `finalVersion` counter (NOT a single value signal) — a burst committed in one tick would otherwise be lost to Angular signal coalescing. Translator drains the queue **sequentially** (`drainSttQueue`) → one row each, in order, no overlapping `translate()` calls. `lastFinalText` now exists only as a live-panel display fallback.
- **Phase 3.5 — Meeting UX:** chat-style history (newest at bottom, auto-scroll, synced EN|FA rows); live panel replaces textarea while capturing; tabbed settings (Translation / Speech / Display).
- **LibreTranslate fix:** Content-Length + error-field handling (see gotchas).
- **Phase 4a — Overlay mode:** floating always-on-top transparent subtitle window at `#/overlay`; translation events BROADCAST to all windows from main; click-through with hover-to-wake toolbar; header toggle button.
- **Phase 4b — History export:** `ExportService` → TXT transcript or SRT subtitles via native save dialog (`export:save` IPC); export popover in audio bar.

**REMAINING (Phase 4 finale, independent):**
- **System tray + global hotkeys** — minimize to tray; start/stop capture & toggle overlay without alt-tab (main-process `Tray` + `globalShortcut`).
- **Package the installer** — `electron-builder` for Windows `.exe` (and mac/linux). Configs already in `electron-builder.json`. Likely the last step. `npm run electron:dist:win`.

**Git:** repo on `main`. Commits: `ba00580` (initial, Phases 1–4a) → `8a6af5a` (history export) → `b5389c0` (CLAUDE.md + docs/memory) → `de90074` (System Audio + mic source picker) → `7f88d3c` (memory) → `499a675` (tsconfig rootDir) → `552b695` (per-row copy-English button) → `306d242` (drop Live-panel idle placeholder) → `d4bc404` (fixed --composer-height: Live/Translate panels same height) → `42b4ff8` (STT per-sentence segmentation). `.gitattributes` normalizes LF; `dist-electron`/`release` gitignored. **No remote yet** — offer to create via `gh` when user wants to push.

**Smaller UX done (2026-06-06):** per-row hover **copy-English** button (`copiedId` signal, `navigator.clipboard`); bottom composer pinned to `--composer-height: 96px` so Live↔Translate swap doesn't shift UI; removed Persian "در انتظار صدا…" idle placeholder.

**Ideas discussed, NOT built:** (1) **Assist/LLM mode** — separate from translation; reuse existing Claude/OpenAI providers; cloud-first (latency/quality), Ollama as optional offline later. Keep translator pure — a distinct *mode*, not blended into the translate pane. (2) **Multi-select rows + selection bar** — click/shift-click rows → Copy / Ask-LLM on the combined block (handles topics spanning multiple rows). Build selection layer first (powers multi-row copy now), hang Ask-LLM off it later.
