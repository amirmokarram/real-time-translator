// Language catalog for the MAIN process. The catalog data is NOT defined here —
// the single source of truth is the renderer's languages.json (src/app/core/models/
// languages.json), which the build copies to dist-electron/config/languages.json.
// We read that copy at startup and keep only what main needs: the English display
// name (for LLM translation prompts) and the RTL flag, plus a small mapping from
// our ISO-639-1 codes to each MT provider's code convention.
import * as fs from 'fs';
import * as path from 'path';

export interface MainLanguage {
  name: string; // English display name, used in LLM prompts
  rtl: boolean;
}

// Shape of one row in the shared languages.json (renderer-owned). We ignore the
// UI-only fields (nativeName, flag) here.
interface CatalogRow {
  code: string;
  name: string;
  rtl: boolean;
}

// Read once at module load. __dirname is dist-electron/ in both dev and packaged
// (asar) runs; the build copy step places languages.json under config/ next to it.
const catalogPath = path.join(__dirname, 'config', 'languages.json');
const rows: CatalogRow[] = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

// Codes are ISO-639-1, which DeepGram, Whisper and most MT providers accept as-is.
export const LANGUAGES: Record<string, MainLanguage> = Object.fromEntries(
  rows.map((row) => [row.code, { name: row.name, rtl: row.rtl }])
);

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
