# Real-Time Translator — Memory Index

Desktop app: real-time English→Persian translation of system audio (meetings/video). Angular 21 + Electron 42. Core pipeline (capture → DeepGram STT → switchable translation → live display) + overlay + export all working (built 2026-06-04). **Assist mode** (LLM Q&A about the conversation, 4 providers incl. local Ollama/Docker Model Runner) added 2026-06-07, merged to `main`. **Published 2026-06-07** as public GitHub repo https://github.com/amirmokarram/real-time-translator — **All Rights Reserved / proprietary** (LICENSE + `UNLICENSED` in package.json), README rewritten with full docs.

- [Collaboration & Environment](collaboration-and-env.md) — how Amir works (plan-first, phase-by-phase), Windows/PowerShell, Node 24.13, project paths
- [Project Architecture](project-architecture.md) — Angular+Electron split, IPC bridge, subsystems map, broadcast pattern, build commands, TS isolation
- [Translation Providers](translation-providers.md) — 7 providers (incl. local **Ollama**/TranslateGemma, added 2026-06-08), interface, registry, IPC flow, per-provider prompt override, how to add one
- **Assist mode** (in [phase-status.md](phase-status.md) Phase 5) — `electron/assist/` mirrors translation: `IAssistProvider`, registry, `assist:ask`/`assist:validate` IPC; 4 providers (Claude, OpenAI, Ollama, OpenAI-compatible/DMR); slide-in panel in app shell; selection→Ask, header→free chat
- [Gotchas & Lessons](gotchas-and-lessons.md) — hard-won non-obvious fixes (Web Speech fails in Electron, flex :host, LibreTranslate Content-Length, click-through). READ BEFORE DEBUGGING.
- [Phase Status](phase-status.md) — Phases 1–5 done (5 = assist mode); remaining: system tray+hotkeys, package installer. Git state + `feature/assist-mode` branch.
