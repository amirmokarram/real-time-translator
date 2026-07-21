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

// AppSettings / ProviderSettings are defined once in shared/app-settings.d.ts
// (shared with the Electron main process) and re-exported here so renderer code
// can keep importing them from this models barrel.
import type { AppSettings, ProviderSettings } from '../../../../shared/app-settings';
export type { AppSettings, ProviderSettings };

// ── Assist mode ─────────────────────────────────────────────────────────────

export interface AssistMessage {
  role: 'user' | 'assistant';
  content: string;
}

// One streamed assist event. requestId ties it to the ask() that spawned it so
// a stopped generation's late chunks can be dropped by the renderer.
export interface AssistStreamEvent {
  requestId?: string;
  text: string;
}

// ── Question Bank ─────────────────────────────────────────────────────────────

// One matching markdown file from the local question bank, chosen by the LLM
// router. `snippet` is a short topic line for the card; the user opens the file to
// read the full prepared answer.
export interface BankMatch {
  path: string;
  title: string;
  snippet: string;
}

// ── Audio ─────────────────────────────────────────────────────────────────────

export interface AudioSource {
  id: string; // 'system:<screenId>' or 'mic:<deviceId>'
  name: string;
  kind: 'system' | 'microphone';
  thumbnail?: string; // optional — microphones have no thumbnail
}

// ── Session recording ─────────────────────────────────────────────────────────

// Which input a recorded chunk belongs to. 'main' is the captured source; 'mic'
// only exists in 'separate' mode, where the microphone gets its own file.
export type RecordingTrack = 'main' | 'mic';

export interface RecordingStartResult {
  paths: Partial<Record<RecordingTrack, string>>;
}

export interface RecordingStopResult {
  files: { track: RecordingTrack; path: string; bytes: number }[];
}

/**
 * The transcript sidecar written next to a session's audio. Offsets are relative
 * to the start of the recording, so a player can seek straight to a line without
 * knowing anything about wall-clock time.
 */
export interface SessionTranscript {
  startedAt: string;   // ISO timestamp of the recording start
  durationMs: number;  // wall-clock length — the WebM header has no usable duration
  languages: { source: string; target: string };
  entries: SessionTranscriptEntry[];
  // Written back into the sidecar after the fact, while reviewing. Absent until
  // the first note is saved.
  notes?: SessionNotes;
}

/**
 * Notes taken while reviewing a session. Line notes are keyed by the transcript
 * entry's `offsetMs` rather than its index: the offset is what the note is really
 * about (a moment in the audio), and it stays meaningful on its own.
 */
export interface SessionNotes {
  session?: string;
  lines?: { offsetMs: number; text: string }[];
}

export interface SessionTranscriptEntry {
  offsetMs: number;
  source: string;
  target: string;
  provider: string;
  confidence?: number;
}

/** One past session as listed by the Review view. */
export interface RecordingSession {
  file: string;   // basename — also the id the rec:// protocol serves
  path: string;   // absolute, shown as a tooltip and used for reveal/delete
  sizeBytes: number;
  modifiedAt: string;
  // Absent when a session was interrupted before its sidecar was written: the
  // audio is still playable, just not navigable.
  transcript: SessionTranscript | null;
}

// ── Translation ───────────────────────────────────────────────────────────────

export interface TranslationEntry {
  id: string;
  source: string; // source-language text (the recognized/typed input)
  target: string; // translated target-language text
  provider: string;
  processingTimeMs: number;
  timestamp: Date;
  /** STT confidence (0–1) for `source`; absent for typed input or backends that don't report one. */
  confidence?: number;
  /**
   * Epoch ms when the speech began, as opposed to `timestamp`, which is when the
   * translation came back — a second or more later. This is what a recording is
   * seeked by. Absent for typed input.
   */
  startedAt?: number;
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
  toggleAlwaysOnTop(): Promise<boolean>;
  isAlwaysOnTop(): Promise<boolean>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: Partial<AppSettings>): Promise<void>;
  getAudioSources(): Promise<AudioSource[]>;
  startCapture(sourceId: string): Promise<void>;
  stopCapture(): Promise<void>;
  translate(payload: { text: string; providerId: string }): Promise<TranslationResult>;
  // Live partial preview — same provider, but not broadcast and not streamed.
  translatePartial(payload: { text: string; providerId: string }): Promise<TranslationResult>;
  assist(payload: {
    messages: AssistMessage[];
    context?: string;
    promptKind?: 'assist' | 'interviewAnswer';
    requestId?: string;
  }): Promise<string>;
  validateAssist(): Promise<{ valid: boolean; error?: string }>;
  getDefaultPrompts(): Promise<{ assist: string; translation: string; interviewAnswer: string }>;
  pickInterviewPromptFile(): Promise<{ path: string | null }>;
  // Question Bank
  bankRoute(query: string): Promise<BankMatch[]>;
  bankOpen(filePath: string): Promise<{ opened: boolean; error?: string }>;
  bankPickFolder(): Promise<{ path: string | null }>;
  validateProvider(payload: { providerId: string }): Promise<{ valid: boolean; error?: string }>;
  getAvailableProviders(): Promise<ProviderMeta[]>;
  // Export
  exportFile(payload: { content: string; defaultName: string }): Promise<{ saved: boolean; path?: string }>;
  // Session recording
  recordingStart(payload: { tracks: RecordingTrack[] }): Promise<RecordingStartResult>;
  recordingChunk(payload: { track: RecordingTrack; chunk: Uint8Array }): Promise<void>;
  recordingStop(): Promise<RecordingStopResult>;
  recordingSaveTranscript(payload: { content: string }): Promise<{ path: string | null }>;
  recordingPickFolder(): Promise<{ path: string | null }>;
  recordingList(): Promise<RecordingSession[]>;
  recordingSaveNotes(payload: {
    file: string;
    notes: SessionNotes;
  }): Promise<{ saved: boolean; error?: string }>;
  recordingReveal(payload: { file: string }): Promise<void>;
  recordingDelete(payload: { file: string }): Promise<{ deleted: boolean; error?: string }>;
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
  onAssistChunk(cb: (event: AssistStreamEvent) => void): () => void;
  onAssistComplete(cb: (event: AssistStreamEvent) => void): () => void;
  onOverlayState(cb: (open: boolean) => void): () => void;
  onAlwaysOnTopState(cb: (on: boolean) => void): () => void;
  // Main-process command (tray menu / global hotkey): toggle audio capture.
  onToggleCaptureCommand(cb: () => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
