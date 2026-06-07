import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  AssistProviderSettings,
  AssistRequest,
  IAssistProvider,
} from '../assist.interface';
import { composeAssistPrompt } from '../../prompts';

// Generic OpenAI-compatible local server: Docker Model Runner, LM Studio, vLLM,
// llama.cpp server, LocalAI, etc. Uses the OpenAI /chat/completions shape against
// a configurable base URL (e.g. http://localhost:12434/engines/v1 for DMR).
// API key is optional — most local servers don't require auth.
export class OpenAICompatibleAssistProvider implements IAssistProvider {
  readonly id = 'openai-compatible';

  private static readonly DEFAULT_ENDPOINT = 'http://localhost:12434/engines/v1';

  async ask(
    request: AssistRequest,
    settings: AssistProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const model = settings.model?.trim();
    if (!model) throw new Error('Model name is required (e.g. "ai/llama3.2"). Set it in Settings → Assist.');

    const base = (settings.endpoint?.trim() || OpenAICompatibleAssistProvider.DEFAULT_ENDPOINT).replace(/\/$/, '');
    const body = JSON.stringify({
      model,
      stream: !!onChunk,
      messages: [
        { role: 'system', content: composeAssistPrompt(request.systemPrompt, request.context) },
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: 2048,
    });

    return onChunk
      ? this.stream(base, body, settings.apiKey, onChunk)
      : this.once(base, body, settings.apiKey);
  }

  private send(base: string, body: string, apiKey: string | undefined): Promise<http.IncomingMessage> {
    const url = new URL(`${base}/chat/completions`);
    const lib = url.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    };
    // Only send auth when a key is configured — local servers usually ignore it.
    if (apiKey?.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;

    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers,
        },
        resolve
      );
      req.on('error', (err: NodeJS.ErrnoException) => {
        reject(
          err.code === 'ECONNREFUSED'
            ? new Error(`Cannot reach the local server at ${base}. Is it running and is host TCP enabled?`)
            : err
        );
      });
      req.write(body);
      req.end();
    });
  }

  private async once(base: string, body: string, apiKey: string | undefined): Promise<string> {
    const res = await this.send(base, body, apiKey);
    return new Promise((resolve, reject) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as {
            choices?: { message: { content: string } }[];
            error?: { message?: string } | string;
          };
          if (parsed.error) {
            const msg = typeof parsed.error === 'string' ? parsed.error : parsed.error.message;
            return reject(new Error(msg ?? 'Server returned an error.'));
          }
          resolve(parsed.choices?.[0]?.message?.content ?? '');
        } catch {
          reject(new Error('Unexpected response from the local server.'));
        }
      });
    });
  }

  // OpenAI-style SSE: "data: {json}" lines, terminated by "data: [DONE]".
  private async stream(
    base: string, body: string, apiKey: string | undefined, onChunk: (c: string) => void
  ): Promise<string> {
    const res = await this.send(base, body, apiKey);
    return new Promise((resolve, reject) => {
      let full = '';
      let buffer = '';

      res.on('data', (raw: Buffer) => {
        buffer += raw.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';     // keep the trailing partial line
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const json = trimmed.slice(6);
          if (json === '[DONE]') continue;
          try {
            const chunk = JSON.parse(json) as { choices: { delta: { content?: string } }[] };
            const text = chunk.choices[0]?.delta?.content ?? '';
            if (text) { full += text; onChunk(text); }
          } catch { /* partial chunk */ }
        }
      });
      res.on('end', () => resolve(full));
      res.on('error', reject);
    });
  }
}
