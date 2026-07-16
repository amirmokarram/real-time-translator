import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../core/services/settings.service';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { AppSettings, ProviderMeta } from '../../core/models/app.models';
import { LANGUAGES } from '../../core/models/languages';

interface ProviderFormState {
  fields: Record<string, string>;
  validating: boolean;
  validResult: { valid: boolean; error?: string } | null;
}

// Leaf nodes of the left-panel settings tree.
type SettingsNode =
  | 'general'
  | 'languages'
  | 'translation-providers'
  | 'translation-prompt'
  | 'stt-engine'
  | 'stt-segmentation'
  | 'assist-provider'
  | 'assist-prompt';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent implements OnInit {
  protected settingsSvc = inject(SettingsService);
  protected bridge = inject(ElectronBridgeService);

  protected providerStates = signal<Record<string, ProviderFormState>>({});
  protected activeNode = signal<SettingsNode>('general');

  // ── Languages (translation direction) ─────────────────────────────────────────
  protected readonly languageList = LANGUAGES;
  protected languageSource = signal('en');
  protected languageTarget = signal('fa');
  // Which provider's config is shown in the Translation → Providers panel. Mirrors
  // the active provider — selecting one here also makes it the active provider.
  protected selectedProvider = signal('claude');
  protected saving = signal(false);
  protected saveSuccess = signal(false);

  // Assist mode — cloud LLMs plus local/offline options.
  protected readonly assistProviderIds = ['claude', 'openai', 'ollama', 'openai-compatible'];
  // Providers that run locally: free-text model + a server endpoint, no API key.
  private readonly localAssistProviders = ['ollama', 'openai-compatible'];
  private readonly assistEndpointDefaults: Record<string, string> = {
    ollama: 'http://localhost:11434',
    'openai-compatible': 'http://localhost:12434/engines/v1',
  };
  protected assistProvider = signal('claude');
  protected assistModel = signal('');
  protected assistEndpoint = signal('http://localhost:11434');
  protected assistSaving = signal(false);
  protected assistSaved = signal(false);
  protected assistValidating = signal(false);
  protected assistValidResult = signal<{ valid: boolean; error?: string } | null>(null);

  // Custom system prompts (empty stored value falls back to these defaults).
  protected assistPrompt = signal('');
  protected translationPrompt = signal('');
  protected interviewPrompt = signal('');
  private defaultPrompts = { assist: '', translation: '', interviewAnswer: '' };
  protected promptSaved = signal<'assist' | 'translation' | 'interview' | null>(null);

  // STT — DeepGram (cloud streaming) or Whisper (local streaming via WhisperLive)
  protected readonly sttProviderIds = ['deepgram', 'whisper'];
  private readonly whisperDefaults = { endpoint: 'ws://localhost:9090', model: 'small' };
  protected sttProvider = signal('deepgram');
  protected sttApiKey = signal('');
  protected sttEndpoint = signal('ws://localhost:9090');
  protected sttModel = signal('small');
  protected sttUseVad = signal(true);
  // Latency tuning (raw knobs)
  protected sttEndpointingMs = signal(800);
  protected sttUtteranceEndMs = signal(1000);
  protected sttSentenceMaxWaitMs = signal(4000);
  protected sttCommitOnClause = signal(false);
  protected sttLivePartial = signal(false);
  protected sttPartialDebounceMs = signal(600);
  protected sttSaving = signal(false);
  protected sttSaved = signal(false);
  protected sttValidating = signal(false);
  protected sttValidResult = signal<{ valid: boolean; error?: string } | null>(null);

  async ngOnInit(): Promise<void> {
    const settings = this.settingsSvc.settings();
    const providers = this.settingsSvc.providers();
    const states: Record<string, ProviderFormState> = {};

    for (const p of providers) {
      const saved = settings?.providers[p.id] ?? {};
      const fields: Record<string, string> = {};
      for (const f of p.configFields) {
        fields[f.key] = (saved as Record<string, string>)[f.key] ?? '';
      }
      states[p.id] = {
        fields,
        validating: false,
        validResult: null,
      };
    }

    this.providerStates.set(states);
    this.selectedProvider.set(this.settingsSvc.activeProvider());
    this.languageSource.set(settings?.languages.source ?? 'en');
    this.languageTarget.set(settings?.languages.target ?? 'fa');
    this.sttProvider.set(settings?.stt.provider ?? 'deepgram');
    this.sttApiKey.set(settings?.stt.apiKey ?? '');
    this.sttEndpoint.set(settings?.stt.endpoint || this.whisperDefaults.endpoint);
    this.sttModel.set(settings?.stt.model || this.whisperDefaults.model);
    this.sttUseVad.set(settings?.stt.useVad ?? true);
    this.sttEndpointingMs.set(settings?.stt.endpointingMs ?? 800);
    this.sttUtteranceEndMs.set(settings?.stt.utteranceEndMs ?? 1000);
    this.sttSentenceMaxWaitMs.set(settings?.stt.sentenceMaxWaitMs ?? 4000);
    this.sttCommitOnClause.set(settings?.stt.commitOnClause ?? false);
    this.sttLivePartial.set(settings?.stt.livePartial ?? false);
    this.sttPartialDebounceMs.set(settings?.stt.partialDebounceMs ?? 600);

    this.assistProvider.set(settings?.assist.provider ?? 'claude');
    this.assistModel.set(settings?.assist.model ?? '');
    this.assistEndpoint.set(settings?.assist.endpoint ?? 'http://localhost:11434');

    // Prompt editors: show the saved custom prompt, or the built-in default.
    this.defaultPrompts = await this.bridge.getDefaultPrompts();
    this.assistPrompt.set(settings?.prompts.assist?.trim() ? settings.prompts.assist : this.defaultPrompts.assist);
    this.translationPrompt.set(
      settings?.prompts.translation?.trim() ? settings.prompts.translation : this.defaultPrompts.translation
    );
    this.interviewPrompt.set(
      settings?.prompts.interviewAnswer?.trim() ? settings.prompts.interviewAnswer : this.defaultPrompts.interviewAnswer
    );
  }

  // ── Languages (translation direction) ─────────────────────────────────────────

  protected async onSourceLanguageChange(code: string): Promise<void> {
    this.languageSource.set(code);
    await this.settingsSvc.updateLanguages({ source: code });
    // The default translation prompt carries ${SOURCE}/${TARGET} tokens resolved at
    // call time, so it's language-independent — no need to re-fetch it here.
  }

  protected async onTargetLanguageChange(code: string): Promise<void> {
    this.languageTarget.set(code);
    await this.settingsSvc.updateLanguages({ target: code });
  }

  // ── System prompts ────────────────────────────────────────────────────────────

  private flashPromptSaved(which: 'assist' | 'translation' | 'interview'): void {
    this.promptSaved.set(which);
    setTimeout(() => { if (this.promptSaved() === which) this.promptSaved.set(null); }, 2000);
  }

  protected async saveAssistPrompt(): Promise<void> {
    await this.settingsSvc.updatePrompts({ assist: this.assistPrompt() });
    this.flashPromptSaved('assist');
  }

  protected resetAssistPrompt(): void {
    this.assistPrompt.set(this.defaultPrompts.assist);
    void this.saveAssistPrompt();
  }

  protected async saveTranslationPrompt(): Promise<void> {
    // Store '' (not the rendered text) when the editor still shows the default, so
    // the language-aware default is resolved live instead of frozen to one language.
    const value = this.translationPrompt().trim() === this.defaultPrompts.translation.trim()
      ? ''
      : this.translationPrompt();
    await this.settingsSvc.updatePrompts({ translation: value });
    this.flashPromptSaved('translation');
  }

  protected resetTranslationPrompt(): void {
    this.translationPrompt.set(this.defaultPrompts.translation);
    void this.saveTranslationPrompt(); // equals the default → persists '' (use live default)
  }

  // Interview Answer prompt (Question Bank no-match branch). Same storage rule as
  // the translation prompt: an unedited default persists as '' so future built-in
  // default improvements flow through automatically.
  protected async saveInterviewPrompt(): Promise<void> {
    const value = this.interviewPrompt().trim() === this.defaultPrompts.interviewAnswer.trim()
      ? ''
      : this.interviewPrompt();
    await this.settingsSvc.updatePrompts({ interviewAnswer: value });
    this.flashPromptSaved('interview');
  }

  protected resetInterviewPrompt(): void {
    this.interviewPrompt.set(this.defaultPrompts.interviewAnswer);
    void this.saveInterviewPrompt(); // equals the default → persists ''
  }

  // Optional prompt FILE: read live by main on each no-match call, so an external
  // skill file stays the single source of truth. When set it overrides the editor.
  protected async pickInterviewPromptFile(): Promise<void> {
    const { path } = await this.bridge.pickInterviewPromptFile();
    if (path) await this.settingsSvc.updatePrompts({ interviewAnswerFile: path });
  }

  protected async clearInterviewPromptFile(): Promise<void> {
    await this.settingsSvc.updatePrompts({ interviewAnswerFile: '' });
  }

  // ── Assist ──────────────────────────────────────────────────────────────────

  // Model choices come from the matching translation provider's metadata, so the
  // assist model list stays in sync with the provider definitions.
  protected assistModelOptions(): { value: string; label: string }[] {
    const meta = this.settingsSvc.providerMeta(this.assistProvider());
    return meta?.configFields.find((f) => f.key === 'model')?.options ?? [];
  }

  protected isLocalAssist(): boolean {
    return this.localAssistProviders.includes(this.assistProvider());
  }

  protected isOllama(): boolean {
    return this.assistProvider() === 'ollama';
  }

  protected isOpenAICompatible(): boolean {
    return this.assistProvider() === 'openai-compatible';
  }

  protected onAssistProviderChange(id: string): void {
    this.assistProvider.set(id);
    const isLocal = this.localAssistProviders.includes(id);
    // Cloud providers have a fixed model list — default to the first option.
    // Local models are free-text (whatever the user pulled), so leave blank.
    this.assistModel.set(isLocal ? '' : this.assistModelOptions()[0]?.value ?? '');
    // Seed the endpoint with the new local provider's sensible default.
    if (isLocal) this.assistEndpoint.set(this.assistEndpointDefaults[id]);
    this.assistSaved.set(false);
    this.assistValidResult.set(null);
  }

  // Cloud assist reuses the chosen provider's translation API key — warn if it's
  // blank. Local providers need no key, so this never applies to them.
  protected assistKeyMissing(): boolean {
    if (this.isLocalAssist()) return false;
    const key = this.settingsSvc.settings()?.providers[this.assistProvider()]?.apiKey;
    return !key?.trim();
  }

  protected assistProviderName(id: string): string {
    if (id === 'ollama') return 'Ollama (Local)';
    if (id === 'openai-compatible') return 'OpenAI-compatible (Local)';
    return this.settingsSvc.providerMeta(id)?.name ?? id;
  }

  protected async saveAssist(): Promise<void> {
    this.assistSaving.set(true);
    try {
      await this.settingsSvc.updateAssist({
        provider: this.assistProvider(),
        model: this.assistModel(),
        endpoint: this.assistEndpoint(),
      });
      this.assistSaved.set(true);
      setTimeout(() => this.assistSaved.set(false), 2000);
    } finally {
      this.assistSaving.set(false);
    }
  }

  // Persist the form, then run a minimal call through the provider to confirm it
  // works (valid key for cloud; reachable server + present model for local).
  protected async testAssist(): Promise<void> {
    this.assistValidating.set(true);
    this.assistValidResult.set(null);
    try {
      await this.settingsSvc.updateAssist({
        provider: this.assistProvider(),
        model: this.assistModel(),
        endpoint: this.assistEndpoint(),
      });
      const result = await this.bridge.validateAssist();
      this.assistValidResult.set(result);
    } catch (err: unknown) {
      this.assistValidResult.set({ valid: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.assistValidating.set(false);
    }
  }

  // The translation provider picked in the Providers panel — also becomes the
  // app's active provider (header dropdown reads the same settings signal).
  protected selectedProviderMeta(): ProviderMeta | undefined {
    return this.settingsSvc.providerMeta(this.selectedProvider());
  }

  protected async onTranslationProviderChange(id: string): Promise<void> {
    this.selectedProvider.set(id);
    this.providerStates.update((s) => ({
      ...s,
      [id]: { ...s[id], validResult: null },
    }));
    await this.settingsSvc.setActiveProvider(id);
  }

  protected setField(providerId: string, key: string, value: string): void {
    this.providerStates.update((s) => ({
      ...s,
      [providerId]: {
        ...s[providerId],
        fields: { ...s[providerId].fields, [key]: value },
        validResult: null,
      },
    }));
  }

  protected async saveProvider(p: ProviderMeta): Promise<void> {
    const state = this.providerStates()[p.id];
    if (!state) return;
    this.saving.set(true);
    try {
      await this.settingsSvc.updateProviderSettings(p.id, state.fields);
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 2000);
    } finally {
      this.saving.set(false);
    }
  }

  protected async validateProvider(p: ProviderMeta): Promise<void> {
    const state = this.providerStates()[p.id];
    if (!state) return;

    await this.settingsSvc.updateProviderSettings(p.id, state.fields);

    this.providerStates.update((s) => ({
      ...s,
      [p.id]: { ...s[p.id], validating: true, validResult: null },
    }));

    try {
      const result = await this.bridge.validateProvider(p.id);
      this.providerStates.update((s) => ({
        ...s,
        [p.id]: { ...s[p.id], validating: false, validResult: result },
      }));
    } catch (err: unknown) {
      this.providerStates.update((s) => ({
        ...s,
        [p.id]: {
          ...s[p.id],
          validating: false,
          validResult: { valid: false, error: err instanceof Error ? err.message : String(err) },
        },
      }));
    }
  }

  protected stateOf(id: string): ProviderFormState | null {
    return this.providerStates()[id] ?? null;
  }

  protected getFieldValue(providerId: string, key: string): string {
    return this.providerStates()[providerId]?.fields[key] ?? '';
  }

  protected isWhisper(): boolean {
    return this.sttProvider() === 'whisper';
  }

  // Parse a numeric <input> value, falling back when blank/invalid.
  protected parseNum(value: string, fallback: number): number {
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) ? n : fallback;
  }

  protected onSttProviderChange(id: string): void {
    this.sttProvider.set(id);
    // Seed sensible Whisper defaults the first time the user switches to it.
    if (id === 'whisper') {
      if (!this.sttEndpoint().trim()) this.sttEndpoint.set(this.whisperDefaults.endpoint);
      if (!this.sttModel().trim()) this.sttModel.set(this.whisperDefaults.model);
    }
    this.sttSaved.set(false);
    this.sttValidResult.set(null);
  }

  // Persist the whole STT section (provider + the fields relevant to it).
  private sttPatch(): Partial<AppSettings['stt']> {
    return {
      provider: this.sttProvider(),
      apiKey: this.sttApiKey(),
      endpoint: this.sttEndpoint().trim(),
      model: this.sttModel().trim(),
      useVad: this.sttUseVad(),
      endpointingMs: this.sttEndpointingMs(),
      utteranceEndMs: this.sttUtteranceEndMs(),
      sentenceMaxWaitMs: this.sttSentenceMaxWaitMs(),
      commitOnClause: this.sttCommitOnClause(),
      livePartial: this.sttLivePartial(),
      partialDebounceMs: this.sttPartialDebounceMs(),
    };
  }

  protected async saveStt(): Promise<void> {
    this.sttSaving.set(true);
    this.sttValidResult.set(null);
    try {
      await this.settingsSvc.updateStt(this.sttPatch());
      this.sttSaved.set(true);
      setTimeout(() => this.sttSaved.set(false), 2000);
    } finally {
      this.sttSaving.set(false);
    }
  }

  protected sttTestDisabled(): boolean {
    if (this.sttValidating()) return true;
    return this.isWhisper() ? !this.sttEndpoint().trim() : !this.sttApiKey().trim();
  }

  protected async testSttConnection(): Promise<void> {
    if (this.sttTestDisabled()) return;
    await this.settingsSvc.updateStt(this.sttPatch());
    this.sttValidating.set(true);
    this.sttValidResult.set(null);

    try {
      const result = this.isWhisper()
        ? await this.testWhisper(this.sttEndpoint().trim())
        : await this.testDeepGram(this.sttApiKey().trim());
      this.sttValidResult.set(result);
    } catch (err: unknown) {
      this.sttValidResult.set({ valid: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.sttValidating.set(false);
    }
  }

  // WhisperLive handshake: open the WS, send a minimal config, and wait for the
  // server's SERVER_READY message (confirms the model is loaded). Reaching the
  // socket but not getting SERVER_READY still counts as reachable.
  private testWhisper(endpoint: string): Promise<{ valid: boolean; error?: string }> {
    return new Promise((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(endpoint);
      } catch {
        resolve({ valid: false, error: 'Invalid endpoint URL' });
        return;
      }
      let opened = false;
      const done = (result: { valid: boolean; error?: string }) => {
        clearTimeout(timeout);
        try { ws.close(); } catch { /* ignore */ }
        resolve(result);
      };
      const timeout = setTimeout(() => {
        done(opened
          ? { valid: true, error: 'Reachable, but no SERVER_READY (model still loading?)' }
          : { valid: false, error: 'Connection timed out — is WhisperLive running?' });
      }, 8000);

      ws.onopen = () => {
        opened = true;
        try {
          ws.send(JSON.stringify({
            uid: 'rtt-test',
            language: this.settingsSvc.settings()?.languages.source ?? 'en',
            task: 'transcribe',
            model: this.sttModel().trim() || this.whisperDefaults.model,
            use_vad: this.sttUseVad(),
          }));
        } catch { /* ignore */ }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { message?: string };
          if (msg.message === 'SERVER_READY') done({ valid: true });
        } catch { /* ignore non-JSON frames */ }
      };

      ws.onerror = () => done({ valid: false, error: 'Connection refused — check the endpoint and that the server is running' });
    });
  }

  private testDeepGram(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return new Promise((resolve) => {
      const ws = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2', ['token', apiKey]);
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ valid: false, error: 'Connection timed out' });
      }, 6000);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close(1000);
        resolve({ valid: true });
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ valid: false, error: 'Connection refused — check your API key' });
      };

      ws.onclose = (ev) => {
        clearTimeout(timeout);
        if (ev.code === 1008) {
          resolve({ valid: false, error: 'Invalid API key (policy violation)' });
        }
      };
    });
  }

  protected async setFontSize(value: number): Promise<void> {
    await this.settingsSvc.updateDisplay({ fontSize: value });
  }

  protected async toggleInterim(value: boolean): Promise<void> {
    await this.settingsSvc.updateDisplay({ showInterimResults: value });
  }

  // How many past translation rows the live history keeps (newest kept, oldest
  // dropped — see translation.service.ts). Clamp to a sane range so a stray/blank
  // input can't persist a value that breaks the history slice.
  protected async setHistoryLength(value: number): Promise<void> {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(1000, Math.max(1, Math.round(value)));
    await this.settingsSvc.updateDisplay({ historyLength: clamped });
  }

  // ── Question Bank ─────────────────────────────────────────────────────────────

  // Native folder picker (main process) → persist the chosen path. Cancelling
  // leaves the current path untouched.
  protected async pickBankFolder(): Promise<void> {
    const { path } = await this.bridge.bankPickFolder();
    if (path) await this.settingsSvc.updateQuestionBank({ folderPath: path });
  }

  protected async clearBankFolder(): Promise<void> {
    await this.settingsSvc.updateQuestionBank({ folderPath: '' });
  }

  // How many matching files "Query From Q Bank" surfaces and injects. Clamp to a
  // small sane range so the injected context can't balloon.
  protected async setBankMaxResults(value: number): Promise<void> {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(10, Math.max(1, Math.round(value)));
    await this.settingsSvc.updateQuestionBank({ maxResults: clamped });
  }
}
