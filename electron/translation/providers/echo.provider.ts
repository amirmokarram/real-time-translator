import { ITranslationProvider, ProviderMeta, TranslationRequest, TranslationResult } from '../provider.interface';
import { ProviderSettings } from '../../settings-store';
import { resolveTranslationPrompt } from '../../prompts';

// Sentinel input: when the translated text is this, the EchoProvider returns the
// RESOLVED system prompt instead of the usual echo. Lets an E2E test assert that
// ${SOURCE}/${TARGET} tokens are substituted with the configured language names at
// translate time (the real call-time path), without surfacing prompts in the UI.
export const E2E_RESOLVED_PROMPT_SENTINEL = '__RESOLVED_PROMPT__';

// Deterministic translation provider used ONLY by end-to-end tests. It performs
// no network call: it prefixes the input so assertions are predictable, and (when
// asked) streams it word-by-word through onChunk so the real chunk-broadcast path
// is exercised. Registered only when process.env.TRANSLATOR_E2E is set, so it can
// never appear in a normal dev/prod run.
export class EchoProvider implements ITranslationProvider {
  readonly meta: ProviderMeta = {
    id: 'echo',
    name: 'Echo (E2E test)',
    requiresApiKey: false,
    supportsStreaming: true,
    configFields: [],
  };

  async translate(
    request: TranslationRequest,
    _settings: ProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<TranslationResult> {
    const start = Date.now();
    // E2E hook: echo the resolved prompt (tokens substituted) so a test can verify
    // call-time ${SOURCE}/${TARGET} substitution; otherwise echo the input.
    const translatedText = request.text.includes(E2E_RESOLVED_PROMPT_SENTINEL)
      ? resolveTranslationPrompt(request.systemPrompt, request.sourceLangName, request.targetLangName)
      : `[fa] ${request.text}`;

    if (onChunk) {
      // Emit the words with their trailing space so the joined chunks equal the
      // full string — mirrors how a real streaming provider feeds the UI.
      for (const token of translatedText.match(/\S+\s*/g) ?? []) onChunk(token);
    }

    return { translatedText, provider: 'echo', processingTimeMs: Date.now() - start };
  }

  async validate(_settings: ProviderSettings): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }
}
