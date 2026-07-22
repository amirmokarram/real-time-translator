import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { isLegacyDefaultTranslationPrompt } from './prompts';
import type { AppSettings, ProviderSettings, SettingsResetSection } from '../shared/app-settings';
// Default settings live in data, not code. Imported as JSON so it's type-checked
// against AppSettings at compile time (missing/mistyped fields = build error). The
// build copy step also ships it to dist-electron/config/ for the packaged app.
import defaultSettings from './config/default-settings.json';

// Re-exported so existing `from './settings-store'` imports keep resolving; the
// canonical definition lives in shared/app-settings.d.ts (shared with the renderer).
export type { AppSettings, ProviderSettings };

const defaults: AppSettings = defaultSettings;

// ── Restore defaults ──────────────────────────────────────────────────────────
// One entry per Settings panel (ids match the renderer's SettingsNode), listing
// the leaf paths that panel owns. A reset copies exactly these back from
// default-settings.json.
//
// The table is a whitelist, not a blacklist, which is the whole point: anything
// expensive to re-enter — API keys, the Whisper/Ollama endpoints, folder paths,
// the chosen microphone — is simply never listed, so no reset can wipe it. Adding
// a field to AppSettings means adding it here too if a panel should reset it.
//
// A '*' segment expands over the keys present in the live settings, so every
// configured provider gets its model/prompt restored while its apiKey survives.
export const RESET_SECTIONS = {
  general: [
    'display.fontSize', 'display.showInterimResults', 'display.historyLength',
    'tray.closeToTray', 'questionBank.maxResults',
  ],
  hotkeys: ['hotkeys.toggleCapture', 'hotkeys.toggleOverlay', 'hotkeys.showHideWindow'],
  languages: ['languages.source', 'languages.target'],
  recording: ['recording.enabled', 'recording.mode', 'recording.micGain', 'recording.bitrateKbps'],
  'translation-providers': ['activeProvider', 'providers.*.model', 'providers.*.prompt'],
  'translation-prompt': ['prompts.translation'],
  // Note endpointingMs/utteranceEndMs sit here, not under segmentation: they are
  // DeepGram connection parameters and the Engine panel is where they're shown.
  // The split follows what each panel RENDERS, not how the fields group
  // conceptually — a panel that can't reset a field it displays is just broken.
  'stt-engine': [
    'stt.provider', 'stt.model', 'stt.deepgramModel', 'stt.useVad',
    'stt.keyterms', 'stt.audioBitrateKbps', 'stt.endpointingMs', 'stt.utteranceEndMs',
  ],
  'stt-segmentation': [
    'stt.sentenceMaxWaitMs', 'stt.commitOnClause',
    'stt.livePartial', 'stt.partialDebounceMs',
  ],
  'assist-provider': ['assist.provider', 'assist.model'],
  'assist-prompt': ['prompts.assist', 'prompts.interviewAnswer'],
  // Exhaustive by construction: a new SettingsResetSection that isn't listed here
  // is a compile error, so a new panel can't ship without saying what it resets.
} as const satisfies Record<SettingsResetSection, readonly string[]>;

export type ResetSection = SettingsResetSection | 'all';

// `window.alwaysOnTop` is deliberately absent from the table above: it is live
// window state with three synced controls, so main applies it through its one
// toggle path (see ipc-handlers) rather than writing the value behind its back.

type Bag = Record<string, unknown>;

// Copy one leaf value from `source` into `target`. A path that defaults don't
// define at all (a provider the defaults have never heard of) deletes the key,
// which is what "restore to default" means for it.
function restorePath(target: unknown, source: unknown, path: readonly string[]): void {
  if (!target || typeof target !== 'object') return;
  const bag = target as Bag;
  const src = (source ?? {}) as Bag;
  const [head, ...rest] = path;

  if (head === '*') {
    for (const key of Object.keys(bag)) restorePath(bag[key], src[key], rest);
    return;
  }
  if (rest.length) {
    restorePath(bag[head], src[head], rest);
    return;
  }
  if (src[head] === undefined) delete bag[head];
  else bag[head] = structuredClone(src[head]);
}

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

  /** The shipped defaults, for callers that need to compare against them. */
  defaults(): AppSettings {
    return structuredClone(defaults);
  }

  /** Restore one panel's settings — or every panel's — to the shipped defaults. */
  async reset(section: ResetSection): Promise<void> {
    const sections = section === 'all'
      ? (Object.keys(RESET_SECTIONS) as SettingsResetSection[])
      : [section];

    for (const s of sections) {
      for (const path of RESET_SECTIONS[s]) {
        restorePath(this.data, defaults, path.split('.'));
      }
    }
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
