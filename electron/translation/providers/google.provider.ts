import * as https from 'https';
import { ITranslationProvider, ProviderMeta, TranslationRequest, TranslationResult } from '../provider.interface';
import { ProviderSettings } from '../../settings-store';
import { toProviderCode } from '../../languages';

export class GoogleProvider implements ITranslationProvider {
  readonly meta: ProviderMeta = {
    id: 'google',
    name: 'Google Translate',
    requiresApiKey: true,
    supportsStreaming: false,
    configFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Google Cloud Translation API key',
      },
    ],
  };

  async translate(
    request: TranslationRequest,
    settings: ProviderSettings
  ): Promise<TranslationResult> {
    if (!settings.apiKey) throw new Error('Google Translate API key is required');
    const start = Date.now();

    const body = JSON.stringify({
      q: request.text,
      source: toProviderCode(request.sourceLang, 'google'),
      target: toProviderCode(request.targetLang, 'google'),
      format: 'text',
    });

    const translated = await this.post(
      `https://translation.googleapis.com/language/translate/v2?key=${settings.apiKey}`,
      body
    );

    const parsed = JSON.parse(translated) as {
      data: { translations: { translatedText: string }[] };
    };

    return {
      translatedText: parsed.data.translations[0].translatedText,
      provider: 'google',
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

  private post(url: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
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
