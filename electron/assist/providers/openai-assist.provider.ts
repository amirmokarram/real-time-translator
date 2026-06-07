import * as https from 'https';
import {
  AssistProviderSettings,
  AssistRequest,
  IAssistProvider,
} from '../assist.interface';
import { composeAssistPrompt } from '../../prompts';

export class OpenAIAssistProvider implements IAssistProvider {
  readonly id = 'openai';

  async ask(
    request: AssistRequest,
    settings: AssistProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    if (!settings.apiKey) throw new Error('OpenAI API key is required (set it in Settings → OpenAI).');

    const model = settings.model ?? 'gpt-4o-mini';
    const body = JSON.stringify({
      model,
      stream: !!onChunk,
      messages: [
        { role: 'system', content: composeAssistPrompt(request.systemPrompt, request.context) },
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: 2048,
    });

    if (onChunk) return this.streamPost(settings.apiKey, body, onChunk);

    const raw = await this.post(settings.apiKey, body);
    const parsed = JSON.parse(raw) as { choices: { message: { content: string } }[] };
    return parsed.choices[0].message.content;
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
