// ── Provider metadata ─────────────────────────────────────────────────────────

export interface ConfigField {
  key: string;
  label: string;
  type: 'password' | 'text' | 'select' | 'textarea';
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface ProviderMeta {
  id: string;
  name: string;
  requiresApiKey: boolean;
  supportsStreaming: boolean;
  configFields: ConfigField[];
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface ProviderSettings {
  apiKey?: string;
  model?: string;
  region?: string;
  endpoint?: string;
}

export interface AppSettings {
  activeProvider: string;
  providers: Record<string, ProviderSettings>;
  stt: {
    provider: string; apiKey: string; language: string; endpoint: string; model: string; useVad: boolean;
    // Latency tuning — see settings-store.ts for semantics.
    endpointingMs: number; utteranceEndMs: number; sentenceMaxWaitMs: number; commitOnClause: boolean;
    // Phase B — live partial translation.
    livePartial: boolean; partialDebounceMs: number;
  };
  assist: { provider: string; model: string; endpoint: string };
  prompts: { assist: string; translation: string };
  audio: { selectedSourceId: string | null };
  display: { fontSize: number; showInterimResults: boolean; historyLength: number };
}

// ── Assist mode ─────────────────────────────────────────────────────────────

export interface AssistMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── Audio ─────────────────────────────────────────────────────────────────────

export interface AudioSource {
  id: string; // 'system:<screenId>' or 'mic:<deviceId>'
  name: string;
  kind: 'system' | 'microphone';
  thumbnail?: string; // optional — microphones have no thumbnail
}

// ── Translation ───────────────────────────────────────────────────────────────

export interface TranslationEntry {
  id: string;
  english: string;
  persian: string;
  provider: string;
  processingTimeMs: number;
  timestamp: Date;
}

export interface TranslationResult {
  translatedText: string;
  provider: string;
  processingTimeMs: number;
}

// ── Electron bridge API ───────────────────────────────────────────────────────

export interface ElectronAPI {
  platform: string;
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  isMaximized(): Promise<boolean>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: Partial<AppSettings>): Promise<void>;
  getAudioSources(): Promise<AudioSource[]>;
  startCapture(sourceId: string): Promise<void>;
  stopCapture(): Promise<void>;
  translate(payload: { text: string; providerId: string }): Promise<TranslationResult>;
  // Live partial preview — same provider, but not broadcast and not streamed.
  translatePartial(payload: { text: string; providerId: string }): Promise<TranslationResult>;
  assist(payload: { messages: AssistMessage[]; context?: string }): Promise<string>;
  validateAssist(): Promise<{ valid: boolean; error?: string }>;
  getDefaultPrompts(): Promise<{ assist: string; translation: string }>;
  validateProvider(payload: { providerId: string }): Promise<{ valid: boolean; error?: string }>;
  getAvailableProviders(): Promise<ProviderMeta[]>;
  // Export
  exportFile(payload: { content: string; defaultName: string }): Promise<{ saved: boolean; path?: string }>;
  // Overlay window
  toggleOverlay(): Promise<boolean>;
  isOverlayOpen(): Promise<boolean>;
  closeOverlay(): Promise<void>;
  setOverlayMouseIgnore(ignore: boolean, forward: boolean): Promise<void>;
  // Events
  onAudioLevel(cb: (level: number) => void): () => void;
  onTranscriptionInterim(cb: (text: string) => void): () => void;
  onTranscriptionFinal(cb: (text: string) => void): () => void;
  onTranslationChunk(cb: (chunk: string) => void): () => void;
  onTranslationComplete(cb: (text: string) => void): () => void;
  onTranslationSource(cb: (text: string) => void): () => void;
  onAssistChunk(cb: (chunk: string) => void): () => void;
  onAssistComplete(cb: (text: string) => void): () => void;
  onOverlayState(cb: (open: boolean) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
