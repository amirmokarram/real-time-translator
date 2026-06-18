---
name: gotchas-and-lessons
description: "Hard-won, non-obvious engineering lessons for the Real-Time Translator — read before debugging audio/STT/overlay/providers"
metadata: 
  node_type: memory
  type: project
  originSessionId: d1468163-6e3b-4140-8e02-a0b3d8eb0ee3
---

Non-obvious constraints discovered the hard way. Each cost real debugging time — check here first.

**Web Speech API does NOT work in Electron.** Chromium's Electron build lacks Google's internal API keys for the speech service, so `webkitSpeechRecognition` always fails with `error: 'network'` no matter the CSP/connectivity. This is why STT uses DeepGram instead. Do not try to "fix" Web Speech API in Electron — it's unfixable.

**Chromium desktop audio capture requires a video track.** `getUserMedia` with `chromeMediaSource: 'desktop'` for loopback audio (Windows WASAPI / macOS CoreAudio) ONLY works if you also request video. Solution in `AudioService`: request both, then immediately `stop()` and discard the video track, keep audio. On macOS this also needs Screen Recording permission.

**`:host { display:flex; height:100% }` is mandatory on full-height components.** Without it, an Angular component host element is `height:auto`, so any `flex:1` child grows unbounded and bottom-anchored elements (e.g. the live panel) fall off-screen. Bit us on the translator layout.

**LibreTranslate needs an explicit `Content-Length` header.** `req.write(body)` without it makes Node use chunked transfer encoding, which LibreTranslate's Python server rejects by resetting the connection → "socket hang up". Fix: `headers['Content-Length'] = Buffer.byteLength(body)`. Also: `libretranslate.com` is PAID (returns `{error: "...get an API key"}`); run locally with `docker run -p 5000:5000 libretranslate/libretranslate --load-only en,fa` → endpoint `http://localhost:5000`. Always check the response `error` field before reading `translatedText` (it returns 200 with an error body).

**CSP must include `wss:` for streaming providers.** DeepGram (and any WebSocket STT/translation) needs `connect-src ... wss:` in the dev CSP header set in `main.ts`. `https:` alone does not cover secure WebSockets.

**DeepGram WebSocket auth uses a subprotocol token.** `new WebSocket(url, ['token', apiKey])` — works from the browser/renderer without custom headers. Audio sent as WebM/Opus chunks via `MediaRecorder` (250ms timeslices). Handle close code 1008 = bad API key.

**HashLocationStrategy is required.** Electron loads the prod build via `file://`, which breaks HTML5 path routing. Router uses `withHashLocation()`. This is also how the overlay window targets a route: it loads `#/overlay`.

**Overlay click-through pattern.** `setIgnoreMouseEvents(true, {forward:true})` makes the window pass clicks through to apps behind it. To keep a toolbar usable, its `mouseenter` calls `setIgnoreMouseEvents(false)` and `mouseleave` re-enables pass-through. Drag uses `-webkit-app-region: drag` on the root and `no-drag` on every button (same pattern as the main window's custom titlebar).

**Auto-scroll history with `setTimeout(...,0)` inside a signal `effect()`,** not `ngAfterViewChecked` (which fires before the new row is in the DOM). Translator history is chat-style: newest at the BOTTOM, single scroll container with (EN|FA) rows so columns stay in sync.

**STT output must bypass the manual textarea.** Captured speech routes straight to `runTranslation()`; the textarea is for manual custom text only. Mixing them caused captured audio to overwrite what the user was typing.

**WhisperLive `whisperlive-gpu:latest` is broken (CUDA 13 vs 12 mismatch).** The upstream GPU image ships CUDA **13** libs (`nvidia-cublas 13.x`, `libcublas.so.13`), but its bundled `ctranslate2 4.8.0` / `faster-whisper 1.2.0` are built against CUDA **12** and need `libcublas.so.12`. Result: server connects, loads the model, receives audio, runs VAD — then **every** chunk fails with `ERROR: Failed to transcribe audio chunk: Library libcublas.so.12 is not found or cannot be loaded`, so the app shows a moving audio meter but **zero transcription** (no error surfaces in the UI — you must read `docker logs`). Fix = patched image ([`docker/whisperlive-gpu-fixed/Dockerfile`](../../docker/whisperlive-gpu-fixed/Dockerfile)): `FROM ...gpu:latest`, `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`, then `ENV LD_LIBRARY_PATH=.../nvidia/cublas/lib:.../nvidia/cudnn/lib`. Verified working on RTX 3070 (8 GB) with `large-v3` at ~75% GPU util. **Debugging lesson: when STT "captures but doesn't detect", check the WhisperLive container logs first — the failure is server-side and silent to the renderer.**
