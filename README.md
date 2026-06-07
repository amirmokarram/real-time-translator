# Real-Time Translator

A cross-platform desktop app for **real-time English → Persian (Farsi) translation of system audio** — meetings, videos, calls, and live interviews. It captures your computer's audio, transcribes it with streaming speech-to-text, translates it live, and shows a synced dual-pane (English | فارسی) view. It also includes an **Assist mode**: an LLM helper that explains the conversation and drafts answers you can read aloud.

Built with Angular 21 + Electron 42. Persian-first UI (Vazirmatn font, RTL, dark theme).

> **License:** All Rights Reserved — this source is public for reference only. See [LICENSE](LICENSE).

---

## Features

- **System-audio capture** — transcribes what you hear (system loopback) or a selected microphone.
- **Streaming speech-to-text** via [Deepgram](https://deepgram.com) (Nova-2), with real-time per-sentence segmentation.
- **6 switchable translation providers** — Claude, Google, DeepL, Microsoft, OpenAI, LibreTranslate.
- **Live dual-pane display** — chat-style history with synced English/Persian rows, auto-scroll, per-row copy.
- **Overlay mode** — a floating, always-on-top, click-through subtitle window for use over other apps.
- **History export** — save the transcript as `.txt` or `.srt` subtitles.
- **Assist mode (LLM Q&A)** — select transcript rows and **Ask**, or open a free-form chat:
  - Tuned by default as an **interview assistant** — explains what's being asked and gives a natural, ready-to-speak answer in simple English.
  - **4 assist providers:** Claude, OpenAI, and two local/offline options — **Ollama** and any **OpenAI-compatible server** (Docker Model Runner, LM Studio, vLLM, llama.cpp, LocalAI).
  - **Markdown rendering** with links opening in your system browser.
  - **Fully customizable system prompts** for both assist and translation.

---

## Tech stack

| Area | Technology |
|------|-----------|
| UI | Angular 21 (standalone components, signals, `@if`/`@for`) |
| Desktop shell | Electron 42 |
| Speech-to-text | Deepgram streaming WebSocket |
| Translation | Claude, Google, DeepL, Microsoft, OpenAI, LibreTranslate |
| Assist / LLM | Claude, OpenAI, Ollama, OpenAI-compatible (e.g. Docker Model Runner) |
| Markdown | `marked` + `DOMPurify` |

---

## Architecture

- **All API keys and network calls live in the Electron main process** — never in the Angular renderer.
- Renderer ↔ main communicate over a secure IPC bridge (`contextBridge` + `electron/preload.ts`, typed `ElectronAPI`).
- Translation events are **broadcast to all windows**, so the overlay mirrors the main window automatically.
- Settings persist to `userData/settings.json`.
- Providers follow a registry pattern: translation providers in `electron/translation/`, assist providers in `electron/assist/`.

```
electron/            Main process: window, IPC, providers, prompts, settings store
  translation/       Translation provider interface + 6 implementations + registry
  assist/            Assist provider interface + 4 implementations + registry
  prompts.ts         Default + custom system prompts
src/app/
  features/          translator, settings, overlay, assist (slide-in panel)
  core/services/     audio, transcription, translation, assist, settings, bridge
  shared/            header, markdown pipe
```

---

## Prerequisites

- **Node.js** 20+ (developed on Node 24)
- **npm**
- A **Deepgram API key** (free tier available) for speech-to-text
- At least one **translation provider** key (or run LibreTranslate locally)
- *(Optional)* For local Assist: **Ollama** or **Docker Model Runner** running locally

---

## Getting started

```bash
# Install dependencies
npm install

# Run in development (Angular dev server + Electron with hot reload)
npm run electron:dev
```

Then configure keys in **Settings**:

1. **Speech Recognition** → paste your Deepgram API key → Test Connection.
2. **Translation** → pick a provider, add its API key → Test Connection. (Switch the active provider from the header dropdown.)
3. *(Optional)* **Assist** → choose Claude / OpenAI (reuses that provider's key) or a local server (Ollama / OpenAI-compatible) → Test Connection.

> **LibreTranslate note:** the public `libretranslate.com` endpoint is paid. Run it locally with Docker:
> `docker run -p 5000:5000 libretranslate/libretranslate --load-only en,fa`

---

## Usage

1. Pick an audio source (System Audio or a microphone) in the bottom bar.
2. Click **Start Capture** — English transcription and Persian translation stream in live.
3. **Overlay**: toggle the floating subtitle window from the header.
4. **Assist**: select one or more transcript rows and click **Ask**, or use the header **Assist** button for free-form chat.
5. **Export**: save the session as `.txt` or `.srt` from the export menu.

---

## Build & package

```bash
# Compile the Electron main process only
npm run electron:compile

# Production build (Angular + Electron)
npm run electron:build

# Package an installer
npm run electron:dist:win     # Windows
npm run electron:dist:mac     # macOS
npm run electron:dist:linux   # Linux
```

---

## License

**Copyright © 2026 Amir Mokarram. All Rights Reserved.**

This repository is public for reference and demonstration only. No permission is granted to use, copy, modify, or distribute the code without the author's written consent. See [LICENSE](LICENSE) for details.
