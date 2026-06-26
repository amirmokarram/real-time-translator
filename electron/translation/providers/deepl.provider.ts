import * as https from 'https';
import * as querystring from 'querystring';
import { ITranslationProvider, ProviderMeta, TranslationRequest, TranslationResult } from '../provider.interface';
import { ProviderSettings } from '../../settings-store';
import { toProviderCode } from '../../languages';

export class DeepLProvider implements ITranslationProvider {
  readonly meta: ProviderMeta = {
    id: 'deepl',
    name: 'DeepL',
    requiresApiKey: true,
    supportsStreaming: false,
    configFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'DeepL API key (free or pro)',
      },
    ],
  };

  async translate(
    request: TranslationRequest,
    settings: ProviderSettings
  ): Promise<TranslationResult> {
    if (!settings.apiKey) throw new Error('DeepL API key is required');
    const start = Date.now();

    const isFree = settings.apiKey.endsWith(':fx');
    const host = isFree ? 'api-free.deepl.com' : 'api.deepl.com';

    const body = querystring.stringify({
      auth_key: settings.apiKey,
      text: request.text,
      source_lang: toProviderCode(request.sourceLang, 'deepl'),
      target_lang: toProviderCode(request.targetLang, 'deepl'),
    });

    const raw = await this.post(host, '/v2/translate', body);
    const parsed = JSON.parse(raw) as { translations: { text: string }[] };

    return {
      translatedText: parsed.translations[0].text,
      provider: 'deepl',
      processingTimeMs: Date.now() - start,
    };
  }

  async validate(settings: ProviderSettings): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.translate({ text: 'hello', sourceLang: 'en', targetLang: 'fa', sourceLangName: 'English', targetLangName: 'Persian (Farsi)' }, settings);
      return { valid: true };
    } catch (err: unknown) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private post(host: string, path: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request({ hostname: host, path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
