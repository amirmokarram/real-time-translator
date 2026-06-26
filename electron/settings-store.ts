import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { isLegacyDefaultTranslationPrompt } from './prompts';
import type { AppSettings, ProviderSettings } from '../shared/app-settings';
// Default settings live in data, not code. Imported as JSON so it's type-checked
// against AppSettings at compile time (missing/mistyped fields = build error). The
// build copy step also ships it to dist-electron/config/ for the packaged app.
import defaultSettings from './config/default-settings.json';

// Re-exported so existing `from './settings-store'` imports keep resolving; the
// canonical definition lives in shared/app-settings.d.ts (shared with the renderer).
export type { AppSettings, ProviderSettings };

const defaults: AppSettings = defaultSettings;

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
