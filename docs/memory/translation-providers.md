---
name: translation-providers
description: "Translation provider abstraction — interface, registry, and all 6 implementations"
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

**IPC flow:** Angular `TranslationService` → `ElectronBridgeService.translate()` → IPC `translation:translate` → `IpcHandlers` → `ProviderRegistry.get(id).translate()` → streaming chunks sent back via `translation:chunk` events → `translation:complete` when done.

**Switching providers:** User selects from header dropdown → `SettingsService.setActiveProvider(id)` → saved to `userData/settings.json` immediately.

**Adding a new provider:** Create `electron/translation/providers/myprovider.provider.ts`, implement `ITranslationProvider`, register in `ProviderRegistry` constructor.

**Quality note:** Claude and DeepL give the best EN→FA. LibreTranslate is rough — free offline fallback only. See [[gotchas-and-lessons]] for the LibreTranslate Content-Length / paid-server traps.

**How to apply:** When adding providers, implement at the Electron level only. Angular only needs the `ProviderMeta` (name, id, configFields) which comes back via IPC.
