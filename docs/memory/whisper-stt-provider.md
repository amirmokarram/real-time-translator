---
name: whisper-stt-provider
description: "Adding Whisper as a 2nd Speech-Recognition provider — streaming via local WhisperLive; design, decisions, phase progress"
metadata: 
  node_type: memory
  type: project
  originSessionId: c12bd86a-7df0-4dc5-8e51-8043acd4ff13
---

Adding **Whisper as a second STT provider** alongside DeepGram (started 2026-06-18, branch `feature/whisper-stt-provider`). See [[phase-status]], [[project-architecture]], [[gotchas-and-lessons]].

**Locked decisions (from plan Q&A):**
- **Streaming, like DeepGram — NOT batch.** Rejected the OpenAI-compatible `/v1/audio/transcriptions` batch endpoint (and VAD-chunked WAV) because it can't replicate DeepGram's interim/real-time feel.
- **Backend = local WhisperLive** (Collabora) over **WebSocket**. Default endpoint `ws://localhost:9090`, configurable. Free/offline; user runs the server (`docker run -p 9090:9090 ghcr.io/collabora/whisperlive-cpu:latest` or GPU image).
- **Location = renderer**, mirroring DeepGram. (Initial plan said Electron main, but a streaming WS to a local server IS DeepGram's situation — a browser WebSocket — so renderer is the truer mirror. Reversed.)
- Server-side VAD (WhisperLive does the sliding window); no client-side VAD.

**Architecture — `ISttStream` strategy (renderer):** `src/app/core/services/stt/`
- `stt-stream.ts` — `ISttStream` { start(stream, opts, cb), stop() } + `SttCallbacks` { final(text, endOfUtterance), interim, utteranceEnd, error, fatal } + `SttStartOptions` { language, apiKey, endpoint, model, useVad }.
- `deepgram-stream.ts` — DeepGram WS/MediaRecorder/reconnect extracted here, wired to callbacks.
- `transcription.service.ts` is now a slim coordinator: owns the sentence-segmentation core (`pendingFinal`, `drainSentences`, `endUtterance`, `emitSentence`, timers, `pendingSentences` queue, public signals) and delegates streaming to a strategy. Public API unchanged (`start`/`stop`/`isRunning`/`interimText`/`lastFinalText`/`finalVersion`/`takePending`).

**Settings:** `stt` grew `endpoint`, `model` (default `small`), `useVad` (in `electron/settings-store.ts` + `app.models.ts` + the hardcoded fallback in `electron-bridge.service.ts`). Speech-Recognition tab has an **Engine selector** (DeepGram ↔ Whisper) with Whisper fields + Test Connection (opens WS, sends config, waits for `SERVER_READY`). Dev CSP in `electron/main.ts` now allows `ws://localhost:* http://localhost:*`.

**WhisperLive protocol (for Phase C):** connect WS → send config JSON `{uid, language, task:'transcribe', model, use_vad}` → server replies `{message:'SERVER_READY'}` → then stream **raw Float32 PCM @ 16 kHz** → receive `{segments:[{text, completed}]}`. **KEY DIFFERENCE from DeepGram:** WhisperLive wants raw PCM (use `AudioContext({sampleRate:16000})` + `ScriptProcessorNode`), NOT WebM/Opus via `MediaRecorder`. Map `completed` segments → `cb.final(text, true)`, in-flight → `cb.interim`.

**Progress (all 4 phases done 2026-06-18):** Phase A (settings/UI/CSP) + Phase B (strategy refactor) committed `bdc56fe`. Phase C — `whisper-stream.ts` (AudioContext+ScriptProcessor PCM @16k + WhisperLive protocol; `transcription.service.start` branches on `stt.provider`). Phase D — connect/ready timeout (`READY_TIMEOUT_MS=30s`: socket opens but no SERVER_READY → reject/reconnect, avoids indefinite hang), CLAUDE.md/README updated to "2 STT providers", architecture rule corrected (STT runs in RENDERER, not main — DeepGram+Whisper both browser WebSockets). Phase C+D **uncommitted** as of this note. Live panel already shows "Listening…" when empty + last sentence between segments, so no extra Whisper indicator needed. **Not yet pushed; not yet copied to `docs/memory/`.**

**Accepted trade-offs:** WhisperLive partials revise as the window slides (less stable than DeepGram interim); heavier local server; two audio-capture modes coexist (MediaRecorder for DeepGram vs AudioContext/PCM for Whisper).
