import { ITranslationProvider, ProviderMeta, TranslationRequest, TranslationResult } from '../provider.interface';
import { ProviderSettings } from '../../settings-store';

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
    const translatedText = `[fa] ${request.text}`;

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
