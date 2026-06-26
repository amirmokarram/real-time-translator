import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { isLegacyDefaultTranslationPrompt } from './prompts';

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

const defaults: AppSettings = {
  activeProvider: 'claude',
  providers: {
    claude: { model: 'claude-sonnet-4-6' },
    google: {},
    deepl: {},
    microsoft: { region: 'eastus' },
    openai: { model: 'gpt-4o-mini' },
    libretranslate: { endpoint: 'http://localhost:5000' },
    ollama: { model: '', endpoint: 'http://localhost:11434' },
  },
  languages: {
    source: 'en',
    target: 'fa',
  },
  stt: {
    provider: 'deepgram',
    apiKey: '',
    endpoint: 'ws://localhost:9090',
    model: 'small',
    useVad: true,
    endpointingMs: 800,
    utteranceEndMs: 1000,
    sentenceMaxWaitMs: 4000,
    commitOnClause: false,
    livePartial: false,
    partialDebounceMs: 600,
  },
  assist: {
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    endpoint: 'http://localhost:11434',
  },
  prompts: {
    assist: '',
    translation: '',
  },
  audio: {
    selectedSourceId: null,
  },
  display: {
    fontSize: 16,
    showInterimResults: true,
    historyLength: 50,
  },
};

export class SettingsStore {
  private filePath: string = '';
  private data: AppSettings = structuredClone(defaults);

  async load(): Promise<void> {
    this.filePath = path.join(app.getPath('userData'), 'settings.json');
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.data = this.merge(defaults, parsed);
    } catch {
      this.data = structuredClone(defaults);
    }
    await this.migratePrompts();
  }

  // One-time cleanup: earlier versions persisted hardcoded English→Persian default
  // prompts (the global translation prompt and the auto-seeded Ollama prompt). Now
  // that the language pair is configurable, those frozen defaults would override the
  // language-aware ones. Clear any stored prompt that exactly matches a known legacy
  // default so it falls back to the live default; genuinely custom prompts are kept.
  private async migratePrompts(): Promise<void> {
    let changed = false;

    if (isLegacyDefaultTranslationPrompt(this.data.prompts.translation)) {
      this.data.prompts.translation = '';
      changed = true;
    }
    for (const cfg of Object.values(this.data.providers)) {
      if (isLegacyDefaultTranslationPrompt(cfg.prompt)) {
        cfg.prompt = '';
        changed = true;
      }
    }

    if (changed) await this.persist();
  }

  get(): AppSettings {
    return structuredClone(this.data);
  }

  async update(partial: Partial<AppSettings>): Promise<void> {
    this.data = this.merge(this.data, partial);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private merge<T extends object>(base: T, override: Partial<T>): T {
    const result = structuredClone(base);
    for (const key of Object.keys(override) as (keyof T)[]) {
      const val = override[key];
      if (val && typeof val === 'object' && !Array.isArray(val) && typeof result[key] === 'object') {
        (result as Record<string, unknown>)[key as string] = this.merge(
          result[key] as object,
          val as object
        );
      } else if (val !== undefined) {
        (result as Record<string, unknown>)[key as string] = val;
      }
    }
    return result;
  }
}
