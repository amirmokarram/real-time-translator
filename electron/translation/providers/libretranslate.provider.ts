import * as https from 'https';
import * as http from 'http';
import { ITranslationProvider, ProviderMeta, TranslationRequest, TranslationResult } from '../provider.interface';
import { ProviderSettings } from '../../settings-store';

export class LibreTranslateProvider implements ITranslationProvider {
  readonly meta: ProviderMeta = {
    id: 'libretranslate',
    name: 'LibreTranslate (Open Source)',
    requiresApiKey: false,
    supportsStreaming: false,
    configFields: [
      {
        key: 'endpoint',
        label: 'Server URL',
        type: 'text',
        placeholder: 'http://localhost:5000  (or a community server)',
      },
      {
        key: 'apiKey',
        label: 'API Key (optional)',
        type: 'password',
        placeholder: 'Required by libretranslate.com; not needed locally',
      },
    ],
  };

  async translate(
    request: TranslationRequest,
    settings: ProviderSettings
  ): Promise<TranslationResult> {
    const endpoint = settings.endpoint ?? 'https://libretranslate.com';
    const start = Date.now();

    const body = JSON.stringify({
      q: request.text,
      source: 'en',
      target: 'fa',
      format: 'text',
      ...(settings.apiKey ? { api_key: settings.apiKey } : {}),
    });

    const url = new URL('/translate', endpoint);
    const raw = await this.post(url, body);

    let parsed: { translatedText?: string; error?: string };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new Error(`LibreTranslate returned non-JSON response: ${raw.slice(0, 120)}`);
    }

    if (parsed.error) {
      throw new Error(`LibreTranslate: ${parsed.error}`);
    }
    if (!parsed.translatedText) {
      throw new Error('LibreTranslate returned an empty translation. Check the server URL and language support.');
    }

    return {
      translatedText: parsed.translatedText,
      provider: 'libretranslate',
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

  private post(url: URL, body: string): Promise<string> {
    const lib = url.protocol === 'https:' ? https : http;
    const buf = Buffer.from(body, 'utf-8');

    return new Promise((resolve, reject) => {
      const req = (lib as typeof https).request(
        {
          hostname: url.hostname,
          port: url.port ? Number(url.port) : undefined,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': buf.byteLength,  // required — prevents chunked encoding
          },
          timeout: 20_000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(
          `LibreTranslate timed out. Is the server running at ${url.hostname}:${url.port}? ` +
          `If using Docker, wait a minute for models to finish loading.`
        ));
      });
      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          reject(new Error(
            `Cannot connect to LibreTranslate at ${url.href}. ` +
            `Start the container: docker run -p 5000:5000 libretranslate/libretranslate --load-only en,fa`
          ));
        } else {
          reject(err);
        }
      });
      req.write(buf);
      req.end();
    });
  }
}
