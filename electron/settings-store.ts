import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';

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
    provider: string;
    apiKey: string;
    language: string;
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
  },
  stt: {
    provider: 'deepgram',
    apiKey: '',
    language: 'en',
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
