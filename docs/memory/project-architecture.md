---
name: project-architecture
description: Core architecture decisions for the Real-Time Translator Electron + Angular app
metadata: 
  node_type: memory
  type: project
  originSessionId: d1468163-6e3b-4140-8e02-a0b3d8eb0ee3
---

Real-time English → Persian desktop translator built with Angular 21 + Electron 42.

**Why:** Amir wants to translate system audio (movies, meetings, YouTube) in real-time to Persian (Farsi) while watching/listening.

**Stack:**
- Angular 21 (standalone components, signals, `@if`/`@for` control flow) — renderer process
- Electron 42 — desktop shell
- DeepGram — streaming speech-to-text (WebSocket)
- Switchable translation providers — see [[translation-providers]]
- Persian UI: Vazirmatn font, RTL; dark theme via CSS vars in `src/styles.scss`

**Key architectural decisions:**
- All translation API calls happen in Electron **main process** (API keys never reach renderer)
- Angular communicates via IPC bridge (`contextBridge` + `preload.ts`)
- `HashLocationStrategy` used for router — required for `file://` loading in Electron prod builds
- Audio capture uses Electron `desktopCapturer` → routes loopback source to `getUserMedia`
- Angular build output: `dist/renderer/browser/` — Electron loads `index.html` from there in prod

**Build commands:**
- `npm run electron:dev` — dev mode (ng serve on :4200 + Electron hot-reload)
- `npm run electron:dist` — production build + electron-builder packaging
- `npm run electron:compile` — compile Electron TypeScript only (to `dist-electron/`)

**TypeScript isolation:**
- `tsconfig.app.json` includes only `src/**/*.ts` — browser types, no Node
- `tsconfig.electron.json` targets CommonJS, includes only `electron/**/*`

**Subsystems (where things live):**
| Subsystem | Renderer | Electron main | Key decision |
|---|---|---|---|
| Audio capture | `core/services/audio.service.ts` | `audio-capture.ts` (enumerate screens only) | loopback via `getUserMedia` in renderer; RMS meter |
| STT | `core/services/transcription.service.ts` | — | DeepGram WS direct from renderer |
| Translation | `core/services/translation.service.ts` | `ipc-handlers.ts` + `translation/` | API calls in main; events broadcast to all windows |
| Overlay | `features/overlay/` | `overlay-window.ts` (`OverlayManager`) | separate transparent window at `#/overlay`; subscribes to broadcast events |
| Export | `core/services/export.service.ts` | `export:save` handler | native save dialog (`dialog.showSaveDialog`) |
| Settings | `core/services/settings.service.ts` | `settings-store.ts` | JSON in `userData/`; signals in renderer |

**Broadcast pattern:** translation events (`translation:source` / `:chunk` / `:complete`) are sent to ALL windows via `BrowserWindow.getAllWindows()` so the overlay mirrors the main window with zero extra translation cost.

**How to apply:** Always keep API key handling in the Electron main process. Never move it to Angular services. New cross-window data should use the broadcast helper in `ipc-handlers.ts`.
