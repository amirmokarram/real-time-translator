import { Injectable } from '@angular/core';
import {
  AppSettings,
  AssistMessage,
  AssistStreamEvent,
  AudioSource,
  BankMatch,
  ElectronAPI,
  ProviderMeta,
  TranslationResult,
} from '../models/app.models';

const mockSettings: AppSettings = {
  activeProvider: 'claude',
  providers: {
    claude: { model: 'claude-sonnet-4-6' },
    google: {},
    deepl: {},
    microsoft: { region: 'eastus' },
    openai: { model: 'gpt-4o-mini' },
    libretranslate: { endpoint: 'https://libretranslate.com' },
  },
  languages: { source: 'en', target: 'fa' },
  stt: {
    provider: 'deepgram', apiKey: '', endpoint: 'ws://localhost:9090', model: 'small', useVad: true,
    endpointingMs: 800, utteranceEndMs: 1000, sentenceMaxWaitMs: 4000, commitOnClause: false,
    livePartial: false, partialDebounceMs: 600,
  },
  assist: { provider: 'claude', model: 'claude-sonnet-4-6', endpoint: 'http://localhost:11434' },
  prompts: { assist: '', translation: '', interviewAnswer: '', interviewAnswerFile: '' },
  audio: { selectedSourceId: null },
  questionBank: { folderPath: '', maxResults: 3 },
  display: { fontSize: 16, showInterimResults: true, historyLength: 50 },
  tray: { closeToTray: true },
  hotkeys: { toggleCapture: 'Ctrl+Alt+C', toggleOverlay: 'Ctrl+Alt+O', showHideWindow: 'Ctrl+Alt+H' },
};

@Injectable({ providedIn: 'root' })
export class ElectronBridgeService {
  private readonly api: ElectronAPI | null =
    typeof window !== 'undefined' && 'electronAPI' in window
      ? window.electronAPI
      : null;

  readonly isElectron = !!this.api;
  readonly platform = this.api?.platform ?? 'browser';

  getSettings(): Promise<AppSettings> {
    return this.api?.getSettings() ?? Promise.resolve(mockSettings);
  }

  saveSettings(settings: Partial<AppSettings>): Promise<void> {
    return this.api?.saveSettings(settings) ?? Promise.resolve();
  }

  minimizeWindow(): void {
    this.api?.minimizeWindow();
  }

  maximizeWindow(): void {
    this.api?.maximizeWindow();
  }

  closeWindow(): void {
    this.api?.closeWindow();
  }

  getAudioSources(): Promise<AudioSource[]> {
    return (
      this.api?.getAudioSources() ??
      Promise.resolve<AudioSource[]>([
        { id: 'system:mock', name: 'System Audio (Mock)', kind: 'system' },
      ])
    );
  }

  startCapture(sourceId: string): Promise<void> {
    return this.api?.startCapture(sourceId) ?? Promise.resolve();
  }

  stopCapture(): Promise<void> {
    return this.api?.stopCapture() ?? Promise.resolve();
  }

  translate(payload: { text: string; providerId: string }): Promise<TranslationResult> {
    if (this.api) return this.api.translate(payload);
    // Browser mock: echo back
    return Promise.resolve({
      translatedText: `[Mock] ${payload.text}`,
      provider: 'mock',
      processingTimeMs: 0,
    });
  }

  translatePartial(payload: { text: string; providerId: string }): Promise<TranslationResult> {
    if (this.api) return this.api.translatePartial(payload);
    return Promise.resolve({
      translatedText: `[Mock] ${payload.text}`,
      provider: 'mock',
      processingTimeMs: 0,
    });
  }

  assist(payload: {
    messages: AssistMessage[];
    context?: string;
    promptKind?: 'assist' | 'interviewAnswer';
    requestId?: string;
  }): Promise<string> {
    if (this.api) return this.api.assist(payload);
    // Browser mock: echo the last question
    const last = payload.messages[payload.messages.length - 1]?.content ?? '';
    return Promise.resolve(`[Mock assist] You asked: ${last}`);
  }

  validateAssist(): Promise<{ valid: boolean; error?: string }> {
    return this.api?.validateAssist() ?? Promise.resolve({ valid: true });
  }

  getDefaultPrompts(): Promise<{ assist: string; translation: string; interviewAnswer: string }> {
    return (
      this.api?.getDefaultPrompts() ??
      Promise.resolve({ assist: '', translation: '', interviewAnswer: '' })
    );
  }

  pickInterviewPromptFile(): Promise<{ path: string | null }> {
    return this.api?.pickInterviewPromptFile() ?? Promise.resolve({ path: null });
  }

  // ── Question Bank ────────────────────────────────────────────────────────────

  bankRoute(query: string): Promise<BankMatch[]> {
    return this.api?.bankRoute(query) ?? Promise.resolve<BankMatch[]>([]);
  }

  bankOpen(filePath: string): Promise<{ opened: boolean; error?: string }> {
    return this.api?.bankOpen(filePath) ?? Promise.resolve({ opened: false });
  }

  bankPickFolder(): Promise<{ path: string | null }> {
    return this.api?.bankPickFolder() ?? Promise.resolve({ path: null });
  }

  onAssistChunk(cb: (event: AssistStreamEvent) => void): () => void {
    return this.api?.onAssistChunk(cb) ?? (() => {});
  }

  onAssistComplete(cb: (event: AssistStreamEvent) => void): () => void {
    return this.api?.onAssistComplete(cb) ?? (() => {});
  }

  validateProvider(providerId: string): Promise<{ valid: boolean; error?: string }> {
    return (
      this.api?.validateProvider({ providerId }) ??
      Promise.resolve({ valid: true })
    );
  }

  getAvailableProviders(): Promise<ProviderMeta[]> {
    return (
      this.api?.getAvailableProviders() ??
      Promise.resolve([
        {
          id: 'mock',
          name: 'Mock (Browser)',
          requiresApiKey: false,
          supportsStreaming: false,
          configFields: [],
        },
      ])
    );
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  exportFile(content: string, defaultName: string): Promise<{ saved: boolean; path?: string }> {
    if (this.api) return this.api.exportFile({ content, defaultName });
    // Browser fallback: trigger a blob download
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(url);
    return Promise.resolve({ saved: true });
  }

  // ── Overlay ────────────────────────────────────────────────────────────────

  toggleOverlay(): Promise<boolean> {
    return this.api?.toggleOverlay() ?? Promise.resolve(false);
  }

  isOverlayOpen(): Promise<boolean> {
    return this.api?.isOverlayOpen() ?? Promise.resolve(false);
  }

  closeOverlay(): Promise<void> {
    return this.api?.closeOverlay() ?? Promise.resolve();
  }

  setOverlayMouseIgnore(ignore: boolean, forward: boolean): Promise<void> {
    return this.api?.setOverlayMouseIgnore(ignore, forward) ?? Promise.resolve();
  }

  onOverlayState(cb: (open: boolean) => void): () => void {
    return this.api?.onOverlayState(cb) ?? (() => {});
  }

  onToggleCaptureCommand(cb: () => void): () => void {
    return this.api?.onToggleCaptureCommand(cb) ?? (() => {});
  }

  onTranslationSource(cb: (text: string) => void): () => void {
    return this.api?.onTranslationSource(cb) ?? (() => {});
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  onAudioLevel(cb: (level: number) => void): () => void {
    return this.api?.onAudioLevel(cb) ?? (() => {});
  }

  onTranscriptionInterim(cb: (text: string) => void): () => void {
    return this.api?.onTranscriptionInterim(cb) ?? (() => {});
  }

  onTranscriptionFinal(cb: (text: string) => void): () => void {
    return this.api?.onTranscriptionFinal(cb) ?? (() => {});
  }

  onTranslationChunk(cb: (chunk: string) => void): () => void {
    return this.api?.onTranslationChunk(cb) ?? (() => {});
  }

  onTranslationComplete(cb: (text: string) => void): () => void {
    return this.api?.onTranslationComplete(cb) ?? (() => {});
  }
}
