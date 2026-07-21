// Single source of truth for the persisted settings schema, shared by BOTH the
// Electron main process (electron/settings-store.ts owns load/persist) and the
// Angular renderer (re-exported via src/app/core/models/app.models.ts).
//
// This is a .d.ts on purpose: it carries no runtime code, so it sidesteps the
// `rootDir` isolation between tsconfig.app.json (./src) and tsconfig.electron.json
// (./electron) — a plain .ts here would trip "file is not under rootDir". Both
// tsconfigs include this file explicitly. Keep it type-only (no `const`/runtime).

export interface ProviderSettings {
  apiKey?: string;
  model?: string;
  region?: string;
  endpoint?: string;
  // Optional per-provider translation system prompt. Empty/undefined → fall back
  // to the global settings.prompts.translation (then the built-in default).
  prompt?: string;
}

export interface AppSettings {
  activeProvider: string;
  providers: Record<string, ProviderSettings>;
  // The translation direction. `source` drives STT and the "from" side; `target`
  // drives the translation "to" side. Codes are ISO-639-1 (see electron/languages.ts).
  languages: {
    source: string;
    target: string;
  };
  stt: {
    provider: string;       // 'deepgram' (cloud streaming) | 'whisper' (local streaming)
    apiKey: string;         // DeepGram key; unused by the local Whisper server
    endpoint: string;       // Whisper only: WhisperLive WebSocket URL (ws://host:port)
    model: string;          // Whisper only: model size/name the server should load
    deepgramModel: string;  // DeepGram only: 'nova-3' (best accuracy, newer) | 'nova-2' (widest language coverage)
    useVad: boolean;        // Whisper only: let the server gate on voice activity
    // Custom vocabulary: names, acronyms, product terms, jargon to bias recognition
    // toward. Newline/comma separated. DeepGram sends it as keyterm (Nova-3) or
    // keywords (Nova-2); shared field so it survives an engine switch.
    keyterms: string;
    // DeepGram only: Opus bitrate (kbps) for the audio we upload. Higher = more
    // detail for the recognizer at more upstream bandwidth. 16 was the original
    // value and is noticeably lossy for speech; 32 is effectively transparent.
    audioBitrateKbps: number;
    // ── Latency tuning (lower = snappier, but more fragmented/less accurate) ──
    endpointingMs: number;     // DeepGram only: silence (ms) before a fragment is finalized
    utteranceEndMs: number;    // DeepGram only: end-of-utterance backstop (ms); API floor is 1000
    sentenceMaxWaitMs: number; // both: idle fallback (ms) committing an un-punctuated tail
    commitOnClause: boolean;   // both: also split rows on , ; : — not just . ! ?
    // Phase B — live partial translation: translate in-progress (un-committed)
    // speech on a debounce, showing a live row that revises until the sentence
    // finalizes. More translation calls; the preview is non-broadcast (not in overlay).
    livePartial: boolean;      // both: enable the live preview translation
    partialDebounceMs: number; // both: idle (ms) after the last word before translating the partial
  };
  // Assist mode reuses the matching translation provider's API key; only the
  // provider choice and model live here. endpoint is used by Ollama (local).
  assist: {
    provider: string;
    model: string;
    endpoint: string;
  };
  // Custom system prompts. Empty string → use the built-in default (see prompts.ts).
  // interviewAnswer drives the Question Bank "no match" branch: generating a fresh
  // interview-ready answer when no prepared file fits. interviewAnswerFile, when
  // set, points at a markdown file read LIVE on each call and used as that prompt —
  // so an external skill file stays the single source of truth (no copy to drift).
  prompts: {
    assist: string;
    translation: string;
    interviewAnswer: string;
    interviewAnswerFile: string;
  };
  audio: {
    selectedSourceId: string | null;
  };
  // Question Bank — a local folder of markdown Q&A files. The assist panel's
  // "Query From Q Bank" action searches it, surfaces matching files, and folds
  // their content into the assist context to ground first-person answers.
  questionBank: {
    folderPath: string; // absolute path to the bank folder; '' = not configured
    maxResults: number; // how many matching files to surface / inject (top-N)
  };
  display: {
    fontSize: number;
    showInterimResults: boolean;
    historyLength: number;
  };
  // System tray behavior. When closeToTray is on, the window X hides the app to
  // the tray (capture/translation keep running); quit comes from the tray menu.
  tray: {
    closeToTray: boolean;
  };
  // Main-window behavior. alwaysOnTop keeps the app floating above other
  // windows (toggled from the header pin, the tray menu, or Settings → General).
  window: {
    alwaysOnTop: boolean;
  };
  // Global hotkeys — Electron accelerator strings (e.g. "Ctrl+Alt+C"), active
  // system-wide even when the app isn't focused. Empty string = disabled.
  hotkeys: {
    toggleCapture: string;
    toggleOverlay: string;
    showHideWindow: string;
  };
}
