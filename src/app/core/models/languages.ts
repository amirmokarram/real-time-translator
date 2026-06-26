// Language catalog — the SINGLE source of truth is languages.json in this folder.
// The renderer imports it directly (below); the build copies the same file next to
// the compiled main code, where electron/languages.ts reads it at runtime. This is
// the catalog's canonical home — edit languages.json, not a second hard-coded list.
import languagesData from './languages.json';

export interface Language {
  code: string;       // ISO-639-1 — accepted by DeepGram, Whisper and most MT providers
  name: string;       // English name
  nativeName: string; // endonym, shown in the picker
  flag: string;       // emoji flag for quick visual scanning
  rtl: boolean;       // right-to-left script → drives [dir] and the Vazirmatn font
}

export const LANGUAGES: Language[] = languagesData;

const FALLBACK: Language = { code: 'en', name: 'English', nativeName: 'English', flag: '🏳️', rtl: false };

// Look up a language by code. Falls back to a neutral entry (carrying the given
// code) so an unknown/legacy code never breaks the UI.
export function languageByCode(code: string | undefined): Language {
  return LANGUAGES.find((l) => l.code === code) ?? { ...FALLBACK, code: code ?? 'en' };
}
