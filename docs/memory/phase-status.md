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
- **Phase 3 — STT (DeepGram):** `TranscriptionService` streams via DeepGram WebSocket; `MediaRecorder` WebM/Opus chunks; auto-reconnect; final segments auto-translate via an `effect()` on `lastFinalText`. Settings has DeepGram key + Test Connection. (Free tier 12k min/yr, key at console.deepgram.com.)
- **Phase 3.5 — Meeting UX:** chat-style history (newest at bottom, auto-scroll, synced EN|FA rows); live panel replaces textarea while capturing; tabbed settings (Translation / Speech / Display).
- **LibreTranslate fix:** Content-Length + error-field handling (see gotchas).
- **Phase 4a — Overlay mode:** floating always-on-top transparent subtitle window at `#/overlay`; translation events BROADCAST to all windows from main; click-through with hover-to-wake toolbar; header toggle button.
- **Phase 4b — History export:** `ExportService` → TXT transcript or SRT subtitles via native save dialog (`export:save` IPC); export popover in audio bar.

**REMAINING (Phase 4 finale, independent):**
- **System tray + global hotkeys** — minimize to tray; start/stop capture & toggle overlay without alt-tab (main-process `Tray` + `globalShortcut`).
- **Package the installer** — `electron-builder` for Windows `.exe` (and mac/linux). Configs already in `electron-builder.json`. Likely the last step. `npm run electron:dist:win`.

**Git:** repo on `main`. Commits: `ba00580` (initial, Phases 1–4a) → `8a6af5a` (history export) → `b5389c0` (CLAUDE.md + docs/memory) → `de90074` (System Audio + microphone source picker). `.gitattributes` normalizes LF; `dist-electron`/`release` gitignored. **No remote yet** — offer to create via `gh` when user wants to push.
