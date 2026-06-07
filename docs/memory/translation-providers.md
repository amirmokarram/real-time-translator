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

**Per-provider prompt override (added 2026-06-08):** `ProviderSettings.prompt` + new `'textarea'` ConfigField type. IPC resolves system prompt as **per-provider `prompt` → global `settings.prompts.translation` → built-in default** (`electron/ipc-handlers.ts`). Ollama is seeded with a lean `DEFAULT_OLLAMA_TRANSLATION_PROMPT`; cloud providers keep the verbose `DEFAULT_TRANSLATION_PROMPT` (both in `electron/prompts.ts`). The verbose default was reworked to be small-model-robust (explicit anti-leak rules + one-shot example; dropped the misleading نستعلیق/نسخ calligraphy line).

**⚠️ Duplicated type — keep in sync:** `ConfigField`/`ProviderMeta` are defined TWICE — `electron/translation/provider.interface.ts` (main) AND `src/app/core/models/app.models.ts` (renderer). Adding a field `type` (e.g. `'textarea'`) to only one breaks the Angular build with a TS2367 "no overlap" error in `settings.html`. Always change both.

**IPC flow:** Angular `TranslationService` → `ElectronBridgeService.translate()` → IPC `translation:translate` → `IpcHandlers` → `ProviderRegistry.get(id).translate()` → streaming chunks sent back via `translation:chunk` events → `translation:complete` when done.

**Switching providers:** User selects from header dropdown → `SettingsService.setActiveProvider(id)` → saved to `userData/settings.json` immediately.

**Adding a new provider:** Create `electron/translation/providers/myprovider.provider.ts`, implement `ITranslationProvider`, register in `ProviderRegistry` constructor, add a default entry to `settings-store.ts`.

**Quality note:** Claude and DeepL give the best EN→FA. LibreTranslate is rough — free offline fallback only. See [[gotchas-and-lessons]] for the LibreTranslate Content-Length / paid-server traps.

**How to apply:** When adding providers, implement at the Electron level only. Angular only needs the `ProviderMeta` (name, id, configFields) which comes back via IPC.
