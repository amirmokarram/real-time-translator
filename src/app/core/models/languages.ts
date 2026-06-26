// Language catalog for the RENDERER. Drives the Settings dropdowns, the column
// headers (flag + native name), and the per-cell text direction/font. The main
// process keeps its own minimal catalog (electron/languages.ts) for prompts and
// MT provider code mapping — kept separate because they compile in different TS
// contexts. Keep the two code lists in sync.

export interface Language {
  code: string;       // ISO-639-1 — accepted by DeepGram, Whisper and most MT providers
  name: string;       // English name
  nativeName: string; // endonym, shown in the picker
  flag: string;       // emoji flag for quick visual scanning
  rtl: boolean;       // right-to-left script → drives [dir] and the Vazirmatn font
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧', rtl: false },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', flag: '🇮🇷', rtl: true },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', rtl: true },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱', rtl: true },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰', rtl: true },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', rtl: false },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', rtl: false },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', rtl: false },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', rtl: false },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹', rtl: false },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', rtl: false },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', rtl: false },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳', rtl: false },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', rtl: false },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', rtl: false },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', rtl: false },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱', rtl: false },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱', rtl: false },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦', rtl: false },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪', rtl: false },
];

const FALLBACK: Language = { code: 'en', name: 'English', nativeName: 'English', flag: '🏳️', rtl: false };

// Look up a language by code. Falls back to a neutral entry (carrying the given
// code) so an unknown/legacy code never breaks the UI.
export function languageByCode(code: string | undefined): Language {
  return LANGUAGES.find((l) => l.code === code) ?? { ...FALLBACK, code: code ?? 'en' };
}
