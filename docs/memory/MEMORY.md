# Real-Time Translator — Memory Index

Desktop app: real-time English→Persian translation of system audio (meetings/video). Angular 21 + Electron 42. Core pipeline (capture → DeepGram STT → switchable translation → live display) + overlay + export all working. Built 2026-06-04.

- [Collaboration & Environment](collaboration-and-env.md) — how Amir works (plan-first, phase-by-phase), Windows/PowerShell, Node 24.13, project paths
- [Project Architecture](project-architecture.md) — Angular+Electron split, IPC bridge, subsystems map, broadcast pattern, build commands, TS isolation
- [Translation Providers](translation-providers.md) — 6 providers, interface, registry, IPC flow, how to add one
- [Gotchas & Lessons](gotchas-and-lessons.md) — hard-won non-obvious fixes (Web Speech fails in Electron, flex :host, LibreTranslate Content-Length, click-through). READ BEFORE DEBUGGING.
- [Phase Status](phase-status.md) — Phases 1–4 mostly done; remaining: system tray+hotkeys, package installer. Git state.
