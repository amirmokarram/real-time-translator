# Real-Time Translator

A cross-platform desktop app for **real-time translation of system audio** — meetings, videos, calls, and live interviews. It captures your computer's audio, transcribes it with streaming speech-to-text, translates it live, and shows a synced dual-pane view. It also includes an **Assist mode**: an LLM helper that explains the conversation and drafts answers you can read aloud.

The **source and target languages are fully user-configurable** (Settings → Languages) — translate between any supported pair from a curated 20-language catalog.

Built with Angular 21 + Electron 42. Dark theme; right-to-left languages (Persian, Arabic, Hebrew, Urdu) render with the Vazirmatn font and correct text direction automatically.

> **License:** All Rights Reserved — this source is public for reference only. See [LICENSE](LICENSE).

---

## Features

- **System-audio capture** — transcribes what you hear (system loopback) or a selected microphone; your source choice is remembered across restarts.
- **Any-to-any language pair** — pick source and target languages (Settings → Languages) from a 20-language catalog; translate between any supported pair. RTL languages get correct direction and font automatically.
- **2 switchable streaming speech-to-text engines** — [Deepgram](https://deepgram.com) (Nova-2, cloud) or [WhisperLive](https://github.com/collabora/WhisperLive) (Whisper, fully local), with real-time per-sentence segmentation.
- **7 switchable translation providers** — Claude, Google, DeepL, Microsoft, OpenAI, LibreTranslate, Ollama (local, e.g. TranslateGemma).
- **Live dual-pane display** — chat-style history with synced source/translation rows, auto-scroll, per-row copy.
- **Overlay mode** — a floating, always-on-top, click-through subtitle window for use over other apps.
- **History export** — save the transcript as `.txt` or `.srt` subtitles.
- **Assist mode (LLM Q&A)** — select transcript rows and **Ask**, or open a free-form chat:
  - Tuned by default as an **interview assistant** — explains what's being asked and gives a natural, ready-to-speak answer in simple English.
  - **4 assist providers:** Claude, OpenAI, and two local/offline options — **Ollama** and any **OpenAI-compatible server** (Docker Model Runner, LM Studio, vLLM, llama.cpp, LocalAI).
  - **Markdown rendering** with links opening in your system browser.
  - **Stop generating** mid-stream (keeps the partial answer) and **copy any answer** with one click.
  - **Fully customizable system prompts** for both assist and translation.
- **Question Bank** — point the app at a local folder of markdown Q&A files (one prepared answer per file, `# heading` = the question). In the assist panel, **Query From Q Bank** asks the configured LLM which prepared file answers the selected question — plain text-in/text-out routing that works with every assist provider, local ones included. A match opens your own prepared answer; no match generates a fresh interview-ready answer (its prompt is customizable, or read live from a markdown file you point at).
- **System tray** — closing the window hides the app to the tray while capture and translation keep running (toggle in Settings → General); the tray menu shows/hides the window, starts/stops capture, toggles the overlay, and quits.
- **Global hotkeys** — system-wide shortcuts that work even when the app isn't focused: `Ctrl+Alt+C` start/stop capture, `Ctrl+Alt+O` toggle overlay, `Ctrl+Alt+H` show/hide window. Rebind or disable each in Settings → Hotkeys (changes apply instantly, no restart).
- **Always on top** — pin the main window above other apps (handy next to a meeting): header pin button, tray menu checkbox, or Settings → General. Remembered across restarts.

---

## Tech stack

| Area | Technology |
|------|-----------|
| UI | Angular 21 (standalone components, signals, `@if`/`@for`) |
| Desktop shell | Electron 42 |
| Speech-to-text | Deepgram (cloud) or WhisperLive (local) — streaming WebSocket |
| Translation | Claude, Google, DeepL, Microsoft, OpenAI, LibreTranslate, Ollama |
| Assist / LLM | Claude, OpenAI, Ollama, OpenAI-compatible (e.g. Docker Model Runner) |
| Markdown | `marked` + `DOMPurify` |

---

## Architecture

- **All API keys and network calls live in the Electron main process** — never in the Angular renderer.
- Renderer ↔ main communicate over a secure IPC bridge (`contextBridge` + `electron/preload.ts`, typed `ElectronAPI`).
- Translation events are **broadcast to all windows**, so the overlay mirrors the main window automatically.
- Settings persist to `userData/settings.json`.
- Providers follow a registry pattern: translation providers in `electron/translation/`, assist providers in `electron/assist/`.
- **STT streaming is the exception** — it runs in the renderer (browser `WebSocket`) behind an `ISttStream` strategy in `core/services/stt/`, with Deepgram and Whisper implementations.

```
electron/            Main process: window, IPC, providers, prompts, settings store
  translation/       Translation provider interface + 7 implementations + registry
  assist/            Assist provider interface + 4 implementations + registry
  question-bank/     Folder index + LLM router + keyword fallback for prepared answers
  prompts.ts         Default + custom system prompts
src/app/
  features/          translator, settings, overlay, assist (slide-in panel)
  core/services/     audio, transcription, translation, assist, settings, bridge
    stt/             ISttStream strategy: Deepgram + Whisper (+ mock for tests)
  shared/            header, markdown pipe
e2e/                 Playwright end-to-end test suite
```

---

## Prerequisites

- **Node.js** 20+ (developed on Node 24)
- **npm**
- For speech-to-text, either a **Deepgram API key** (free tier available) **or** a local **WhisperLive** server (no key, runs offline)
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

1. *(Optional)* **Languages** → choose the source and target languages from the catalog. Prompts can reference the active pair via the `${SOURCE}` / `${TARGET}` tokens.
2. **Speech Recognition** → choose an engine. **Deepgram** (cloud): paste your API key. **Whisper** (local): start a [WhisperLive](https://github.com/collabora/WhisperLive) server (see note below), then set the endpoint (`ws://localhost:9090`) and model. → Test Connection.
3. **Translation** → pick a provider, add its API key → Test Connection. (Switch the active provider from the header dropdown.)
4. *(Optional)* **Assist** → choose Claude / OpenAI (reuses that provider's key) or a local server (Ollama / OpenAI-compatible) → Test Connection.
5. *(Optional)* **General → Question Bank Folder** → pick a local folder of markdown Q&A files to enable **Query From Q Bank** in the assist panel.

> **WhisperLive note (running the local STT server):**
> - **CPU:** `docker run -p 9090:9090 ghcr.io/collabora/whisperlive-cpu:latest`
> - **GPU (NVIDIA):** the upstream `whisperlive-gpu:latest` is currently **broken** — it ships CUDA 13 libs while its bundled `ctranslate2` needs CUDA 12, so every transcription fails with `Library libcublas.so.12 is not found`. Build the patched image in [`docker/whisperlive-gpu-fixed/`](docker/whisperlive-gpu-fixed/Dockerfile) instead:
>   ```bash
>   docker build -t whisperlive-gpu-fixed:latest docker/whisperlive-gpu-fixed
>   docker run -d --name whisperlive --restart unless-stopped --gpus all \
>     -p 9090:9090 -v whisper-cache:/root/.cache/huggingface whisperlive-gpu-fixed:latest
>   ```
> The `-v whisper-cache:...` volume persists the downloaded model across restarts. The model downloads on first connect (e.g. `large-v3` ≈ 3 GB), so the first Test Connection may time out while it downloads — just retry once cached.
>
> **LibreTranslate note:** the public `libretranslate.com` endpoint is paid. Run it locally with Docker:
> `docker run -p 5000:5000 libretranslate/libretranslate --load-only en,fa`

---

## Usage

1. Pick an audio source (System Audio or a microphone) in the bottom bar.
2. Click **Start Capture** — source-language transcription and target-language translation stream in live.
3. **Overlay**: toggle the floating subtitle window from the header.
4. **Assist**: select one or more transcript rows and click **Ask**, or use the header **Assist** button for free-form chat.
5. **Question Bank**: with rows selected and a bank folder configured, click **Query From Q Bank** in the assist panel — matching prepared answers appear as cards (click to open); if nothing matches, an interview-ready answer is generated instead.
6. **Export**: save the session as `.txt` or `.srt` from the export menu.
7. **Tray**: closing the window keeps the app running in the system tray (translation and overlay stay live) — reopen or quit from the tray menu, or turn this off in Settings → General.
8. **Hotkeys**: control the app from anywhere — `Ctrl+Alt+C` (capture), `Ctrl+Alt+O` (overlay), `Ctrl+Alt+H` (show/hide). Rebind in Settings → Hotkeys: click a field, press the new combination, Save.

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

## Testing

End-to-end tests run the packaged Electron app with [Playwright](https://playwright.dev). Network-dependent seams are replaced by deterministic doubles — a renderer-side mock STT stream and a main-side echo provider — so the full capture → transcribe → translate → display pipeline can be exercised offline without API keys.

```bash
# Build, then run the E2E suite
npm run e2e

# Run against an existing build (skip the rebuild)
npm run e2e:only

# Interactive / debugging
npm run e2e:headed   # headed browser
npm run e2e:ui       # Playwright UI mode
```

---

## License

**Copyright © 2026 Amir Mokarram. All Rights Reserved.**

This repository is public for reference and demonstration only. No permission is granted to use, copy, modify, or distribute the code without the author's written consent. See [LICENSE](LICENSE) for details.
