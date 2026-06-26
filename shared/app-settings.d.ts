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
    useVad: boolean;        // Whisper only: let the server gate on voice activity
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
  prompts: {
    assist: string;
    translation: string;
  };
  audio: {
    selectedSourceId: string | null;
  };
  display: {
    fontSize: number;
    showInterimResults: boolean;
    historyLength: number;
  };
}
