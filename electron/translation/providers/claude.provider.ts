import Anthropic from '@anthropic-ai/sdk';
import { ITranslationProvider, ProviderMeta, TranslationRequest, TranslationResult } from '../provider.interface';
import { ProviderSettings } from '../../settings-store';
import { resolveTranslationPrompt } from '../../prompts';

export class ClaudeProvider implements ITranslationProvider {
  readonly meta: ProviderMeta = {
    id: 'claude',
    name: 'Claude (Anthropic)',
    requiresApiKey: true,
    supportsStreaming: true,
    configFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-ant-...',
      },
      {
        key: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Recommended)' },
          { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 (Most Capable)' },
          { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fastest)' },
        ],
      },
    ],
  };

  async translate(
    request: TranslationRequest,
    settings: ProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<TranslationResult> {
    if (!settings.apiKey) throw new Error('Claude API key is required');

    const client = new Anthropic({ apiKey: settings.apiKey });
    const model = settings.model ?? 'claude-sonnet-4-6';
    const start = Date.now();

    const systemPrompt = resolveTranslationPrompt(request.systemPrompt);

    let fullText = '';

    if (onChunk) {
      const stream = client.messages.stream({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: request.text }],
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          fullText += event.delta.text;
          onChunk(event.delta.text);
        }
      }
    } else {
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: request.text }],
      });
      fullText =
        response.content[0].type === 'text' ? response.content[0].text : '';
    }

    return {
      translatedText: fullText,
      provider: 'claude',
      processingTimeMs: Date.now() - start,
    };
  }

  async validate(settings: ProviderSettings): Promise<{ valid: boolean; error?: string }> {
    if (!settings.apiKey) return { valid: false, error: 'API key is required' };
    try {
      const client = new Anthropic({ apiKey: settings.apiKey });
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { valid: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: msg };
    }
  }
}
