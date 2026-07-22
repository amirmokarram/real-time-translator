---
name: collaboration-and-env
description: How Amir likes to work + the dev environment for the Real-Time Translator project
metadata: 
  node_type: memory
  type: user
  originSessionId: d1468163-6e3b-4140-8e02-a0b3d8eb0ee3
  modified: 2026-07-22T21:54:47.822Z
---

**Who:** Amir Mokarram (a.mokarram@gmail.com). Senior Software Engineer, 18+ yrs. Persian (Farsi) native speaker, English around A2–B1. (For deep career/personal context there is a separate `amir-mokarram-profile` skill — use that for CV/career work; this file is just project collaboration prefs.)

**Working style (observed):**
- **Wants a PLAN before any code.** First request literally: "I want to show me plan before anything and also what are you understand from my problem." Lead with understanding + plan; get a go-ahead before implementing.
- **Works phase-by-phase.** Approves one phase, lets it complete, then says "next." Don't run ahead multiple phases unprompted.
- **Tests each phase himself** and returns precise, observation-based feedback (e.g. "the top of the panel changes too quickly and makes me nervous," "DeepGram is not present in ComboBox," "socket hang up"). Treat his bug reports as accurate — investigate the real cause, often verify directly (e.g. curl the endpoint) rather than guess.
- **Values git hygiene** — asks for commits explicitly; commit only when asked. Likes clean messages.
- **When he's given a menu of options, WAIT for him to name one.** On the icon redesign (2026-07-22) he said only "change icon"; I read that as approval for my own recommendation and built it, and he corrected me — "You should pick Bubble + Wave icon". A terse instruction is not a pick. Same session: he dismissed an `AskUserQuestion` modal entirely and answered in prose two turns later, so prefer showing concrete options in the reply over blocking on a modal.
- **Design/UI work goes much faster when he can SEE it.** Rendering the candidate icons at real sizes (96px tile + 16px tray on a dark taskbar strip) is what let him choose in one turn; describing them in prose did not.
- **Appreciates the "what I understood from your problem" framing** and clear comparison tables for decisions.

**Dev environment:**
- **OS:** Windows. **Shell: PowerShell** — the Bash tool fails on quoting in this harness; use the PowerShell tool for commands.
- **Node** v24.13.0, **npm** 11.6.2, **Angular CLI** 21.2.13.
- **Project root:** `D:\Claude-RealTimeTranslator`
- Has **Docker** available (ran LibreTranslate container locally).
- Auto-memory dir for this project: `C:\Users\Amir\.claude\projects\D--Claude-RealTimeTranslator\memory\`

**Build/run reminders:** `npm run electron:dev` (dev), `npm run electron:compile` (Electron TS only), `npm run electron:dist` (package). Always recompile Electron + restart after main-process changes.
