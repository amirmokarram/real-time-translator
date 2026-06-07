import * as https from 'https';
import { ITranslationProvider, ProviderMeta, TranslationRequest, TranslationResult } from '../provider.interface';
import { ProviderSettings } from '../../settings-store';
import { resolveTranslationPrompt } from '../../prompts';

export class OpenAIProvider implements ITranslationProvider {
  readonly meta: ProviderMeta = {
    id: 'openai',
    name: 'OpenAI (GPT)',
    requiresApiKey: true,
    supportsStreaming: true,
    configFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-...',
      },
      {
        key: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Recommended)' },
          { value: 'gpt-4o', label: 'GPT-4o (More Capable)' },
        ],
      },
    ],
  };

  async translate(
    request: TranslationRequest,
    settings: ProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<TranslationResult> {
    if (!settings.apiKey) throw new Error('OpenAI API key is required');
    const start = Date.now();
    const model = settings.model ?? 'gpt-4o-mini';

    const body = JSON.stringify({
      model,
      stream: !!onChunk,
      messages: [
        {
          role: 'system',
          content: resolveTranslationPrompt(request.systemPrompt),
        },
        { role: 'user', content: request.text },
      ],
      max_tokens: 2048,
    });

    if (onChunk) {
      const raw = await this.streamPost(settings.apiKey, body, onChunk);
      return { translatedText: raw, provider: 'openai', processingTimeMs: Date.now() - start };
    }

    const raw = await this.post(settings.apiKey, body);
    const parsed = JSON.parse(raw) as {
      choices: { message: { content: string } }[];
    };
    return {
      translatedText: parsed.choices[0].message.content,
      provider: 'openai',
      processingTimeMs: Date.now() - start,
    };
  }

  async validate(settings: ProviderSettings): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.translate({ text: 'hello', sourceLang: 'en', targetLang: 'fa' }, settings);
      return { valid: true };
    } catch (err: unknown) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private post(apiKey: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private streamPost(apiKey: string, body: string, onChunk: (c: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let full = '';
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      }, (res) => {
        res.on('data', (raw: Buffer) => {
          const lines = raw.toString().split('\n').filter((l) => l.startsWith('data: '));
          for (const line of lines) {
            const json = line.slice(6);
            if (json === '[DONE]') return;
            try {
              const chunk = JSON.parse(json) as { choices: { delta: { content?: string } }[] };
              const text = chunk.choices[0]?.delta?.content ?? '';
              if (text) { full += text; onChunk(text); }
            } catch { /* partial chunk */ }
          }
        });
        res.on('end', () => resolve(full));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
