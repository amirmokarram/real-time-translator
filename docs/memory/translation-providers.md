---
name: translation-providers
description: "Translation provider abstraction — interface, registry, and all 7 implementations"
metadata: 
  node_type: memory
  type: project
  originSessionId: d1468163-6e3b-4140-8e02-a0b3d8eb0ee3
---

**Provider pattern:** All providers implement `ITranslationProvider` in `electron/translation/provider.interface.ts`.
Registry lives in `electron/translation/provider-registry.ts`.

**Implemented providers (electron/translation/providers/):**
| ID | Class | Auth | Streaming |
|---|---|---|---|
| `claude` | `ClaudeProvider` | API key | ✅ (streams via Anthropic SDK) |
| `google` | `GoogleProvider` | API key | ❌ |
| `deepl` | `DeepLProvider` | API key (`:fx` suffix = free tier) | ❌ |
| `microsoft` | `MicrosoftProvider` | API key + region | ❌ |
| `openai` | `OpenAIProvider` | API key | ✅ (SSE stream) |
| `libretranslate` | `LibreTranslateProvider` | Optional | ❌ |
| `ollama` | `OllamaProvider` | None (local server) | ✅ (NDJSON `/api/chat`) |

**Ollama provider (added 2026-06-08):** Local/offline, mirrors the Ollama *assist* provider. No API key; configFields = `model` (free text, e.g. `translategemma`/`llama3.2`) + `endpoint` (default `http://localhost:11434`) + `prompt` (per-provider override, textarea). `requiresApiKey:false` but **Test Connection is still shown for it** (special-cased in settings.html: `p.requiresApiKey || p.id === 'ollama'`) for reachability. Friendly `ECONNREFUSED` → "is `ollama serve` running?". **TranslateGemma** (Google's translation-tuned Gemma 3, 4B/12B/27B, supports `fa`/`fa-IR`/`fa-AF`) is a good fit; dedicated MT models translate WORSE when over-instructed → use a lean prompt.

**Per-provider prompt override (added 2026-06-08):** `ProviderSettings.prompt` + new `'textarea'` ConfigField type. IPC resolves system prompt as **per-provider `prompt` → global `settings.prompts.translation` → built-in default** (`electron/ipc-handlers.ts`). Ollama is seeded with a lean default; cloud providers use the verbose default. Both defaults are static constants (`DEFAULT_TRANSLATION_PROMPT` / `DEFAULT_OLLAMA_TRANSLATION_PROMPT` in `electron/prompts.ts`) written with `${SOURCE}`/`${TARGET}` template tokens — see the token approach below.

**Configurable language pair (added 2026-06-26):** the direction is no longer fixed English→Persian. `settings.languages.{source,target}` (ISO-639-1) is the single source of truth — picked via Settings → Languages (curated dropdowns from a language catalog: `src/app/core/models/languages.ts` renderer + `electron/languages.ts` main). `source` drives STT (`TranscriptionService.start()` reads it; the old unused `stt.language` field was removed); `source`+`target` drive translation. **MT providers** (Google/DeepL/Microsoft/Libre) now use `request.sourceLang`/`targetLang` via `toProviderCode()` (DeepL uppercases; others pass through). **LLM providers** (Claude/OpenAI/Ollama) get `request.sourceLangName`/`targetLangName` and build the prompt from them. **No per-provider language filtering** — unsupported pairs (e.g. Persian on DeepL) surface the provider's own error. UI headers + per-cell text direction/font (`.rtl-text`) are driven by the catalog's `rtl` flag. `TranslationEntry` fields renamed `english`/`persian` → `source`/`target`.

**Language tokens in prompts (added 2026-06-26):** prompts use `${SOURCE}`/`${TARGET}` template tokens, substituted with the configured language names at call time by `applyLanguageTokens()` in `prompts.ts`. `resolveTranslationPrompt`/`resolveOllamaTranslationPrompt` run the substitution on **whatever** prompt wins — default, global custom, or per-provider override — so even a hand-written custom prompt follows the language pair instead of freezing. The Settings editor shows the tokens verbatim (`SOURCE_TOKEN`/`TARGET_TOKEN` constants); `prompts:get-defaults` returns the token template (now language-independent, so no per-language-change re-fetch in `settings.ts`). A hint under the editor documents the tokens.

**Prompt-freeze gotcha (fixed 2026-06-26):** default prompts must **never be persisted as resolved custom strings** or they freeze the language. Earlier versions seeded `providers.ollama.prompt` and let "Reset to default" save the rendered default text — both hardcoded English→Persian and overrode the language-aware defaults. Fixes still in place: (1) Ollama seed removed; falls back to `resolveOllamaTranslationPrompt`. (2) Settings Save/Reset stores `''` when the editor equals the current default. (3) `SettingsStore.migratePrompts()` (on load) clears any stored prompt exactly matching a known legacy en→fa default (`LEGACY_TRANSLATION_PROMPTS` in `prompts.ts`); bespoke prompts kept. The token approach above is the durable fix: storing `''` (live default) is freeze-safe, and a custom prompt with `${SOURCE}`/`${TARGET}` stays language-aware even when persisted.

**⚠️ Duplicated type — keep in sync:** `ConfigField`/`ProviderMeta` are defined TWICE — `electron/translation/provider.interface.ts` (main) AND `src/app/core/models/app.models.ts` (renderer). Adding a field `type` (e.g. `'textarea'`) to only one breaks the Angular build with a TS2367 "no overlap" error in `settings.html`. Always change both.

**IPC flow:** Angular `TranslationService` → `ElectronBridgeService.translate()` → IPC `translation:translate` → `IpcHandlers` → `ProviderRegistry.get(id).translate()` → streaming chunks sent back via `translation:chunk` events → `translation:complete` when done.

**Switching providers:** User selects from header dropdown → `SettingsService.setActiveProvider(id)` → saved to `userData/settings.json` immediately.

**Adding a new provider:** Create `electron/translation/providers/myprovider.provider.ts`, implement `ITranslationProvider`, register in `ProviderRegistry` constructor, add a default entry to `settings-store.ts`.

**Quality note:** Claude and DeepL give the best EN→FA. LibreTranslate is rough — free offline fallback only. See [[gotchas-and-lessons]] for the LibreTranslate Content-Length / paid-server traps.

**How to apply:** When adding providers, implement at the Electron level only. Angular only needs the `ProviderMeta` (name, id, configFields) which comes back via IPC.
