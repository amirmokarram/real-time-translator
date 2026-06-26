// Language catalog for the MAIN process. Holds only what main needs: the English
// display name (for building LLM translation prompts) and the RTL flag, plus a
// small mapping from our ISO-639-1 codes to each MT provider's code convention.
// The renderer keeps its own richer catalog (native names + flags) for the UI —
// the two are intentionally separate because they compile in different TS contexts.

export interface MainLanguage {
  name: string; // English display name, used in LLM prompts
  rtl: boolean;
}

// Codes are ISO-639-1, which DeepGram, Whisper and most MT providers accept as-is.
export const LANGUAGES: Record<string, MainLanguage> = {
  en: { name: 'English', rtl: false },
  fa: { name: 'Persian (Farsi)', rtl: true },
  ar: { name: 'Arabic', rtl: true },
  he: { name: 'Hebrew', rtl: true },
  ur: { name: 'Urdu', rtl: true },
  es: { name: 'Spanish', rtl: false },
  fr: { name: 'French', rtl: false },
  de: { name: 'German', rtl: false },
  it: { name: 'Italian', rtl: false },
  pt: { name: 'Portuguese', rtl: false },
  ru: { name: 'Russian', rtl: false },
  tr: { name: 'Turkish', rtl: false },
  zh: { name: 'Chinese', rtl: false },
  ja: { name: 'Japanese', rtl: false },
  ko: { name: 'Korean', rtl: false },
  hi: { name: 'Hindi', rtl: false },
  nl: { name: 'Dutch', rtl: false },
  pl: { name: 'Polish', rtl: false },
  uk: { name: 'Ukrainian', rtl: false },
  sv: { name: 'Swedish', rtl: false },
};

// English display name for a code (falls back to the raw code if unknown — e.g. a
// code carried over from an older settings.json).
export function languageName(code: string): string {
  return LANGUAGES[code]?.name ?? code;
}

// Translate our ISO-639-1 code into the form a given MT provider expects. Most
// take the lowercase code unchanged; DeepL wants it uppercased. Unsupported pairs
// (e.g. Persian on DeepL) are not special-cased here — the provider's own error
// is surfaced to the user by design.
export function toProviderCode(code: string, provider: string): string {
  switch (provider) {
    case 'deepl':
      return code.toUpperCase();
    default:
      return code;
  }
}
