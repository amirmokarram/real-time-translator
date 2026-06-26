import * as https from 'https';
import { ITranslationProvider, ProviderMeta, TranslationRequest, TranslationResult } from '../provider.interface';
import { ProviderSettings } from '../../settings-store';
import { toProviderCode } from '../../languages';

export class MicrosoftProvider implements ITranslationProvider {
  readonly meta: ProviderMeta = {
    id: 'microsoft',
    name: 'Microsoft Azure Translator',
    requiresApiKey: true,
    supportsStreaming: false,
    configFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'Azure Translator subscription key',
      },
      {
        key: 'region',
        label: 'Region',
        type: 'text',
        placeholder: 'e.g. eastus',
      },
    ],
  };

  async translate(
    request: TranslationRequest,
    settings: ProviderSettings
  ): Promise<TranslationResult> {
    if (!settings.apiKey) throw new Error('Azure API key is required');
    const start = Date.now();

    const from = toProviderCode(request.sourceLang, 'microsoft');
    const to = toProviderCode(request.targetLang, 'microsoft');
    const body = JSON.stringify([{ Text: request.text }]);
    const raw = await this.post(settings.apiKey, settings.region ?? 'eastus', from, to, body);
    const parsed = JSON.parse(raw) as { translations: { text: string }[] }[];

    return {
      translatedText: parsed[0].translations[0].text,
      provider: 'microsoft',
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

  private post(apiKey: string, region: string, from: string, to: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.cognitive.microsofttranslator.com',
        path: `/translate?api-version=3.0&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Ocp-Apim-Subscription-Region': region,
          'Content-Type': 'application/json',
        },
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
}
