import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  AssistProviderSettings,
  AssistRequest,
  IAssistProvider,
} from '../assist.interface';
import { composeAssistPrompt } from '../../prompts';

// Offline assist via a local Ollama server (https://ollama.com). No API key —
// the user runs `ollama serve` and pulls a model (e.g. `ollama pull llama3.2`).
// Uses the /api/chat endpoint, which streams newline-delimited JSON objects.
export class OllamaAssistProvider implements IAssistProvider {
  readonly id = 'ollama';

  private static readonly DEFAULT_ENDPOINT = 'http://localhost:11434';

  async ask(
    request: AssistRequest,
    settings: AssistProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const model = settings.model?.trim();
    if (!model) throw new Error('Ollama model name is required (e.g. "llama3.2"). Set it in Settings → Assist.');

    const base = (settings.endpoint?.trim() || OllamaAssistProvider.DEFAULT_ENDPOINT).replace(/\/$/, '');
    const body = JSON.stringify({
      model,
      stream: !!onChunk,
      messages: [
        { role: 'system', content: composeAssistPrompt(request.systemPrompt, request.context) },
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    return onChunk
      ? this.stream(base, body, onChunk)
      : this.once(base, body);
  }

  private request(base: string, body: string): Promise<http.IncomingMessage & { req: http.ClientRequest }> {
    const url = new URL('/api/chat', base);
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => resolve(Object.assign(res, { req }))
      );
      req.on('error', (err: NodeJS.ErrnoException) => {
        reject(
          err.code === 'ECONNREFUSED'
            ? new Error(`Cannot reach Ollama at ${base}. Is it running? Start it with "ollama serve".`)
            : err
        );
      });
      req.write(body);
      req.end();
    });
  }

  // Non-streaming: Ollama returns a single JSON object.
  private async once(base: string, body: string): Promise<string> {
    const res = await this.request(base, body);
    return new Promise((resolve, reject) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { message?: { content?: string }; error?: string };
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed.message?.content ?? '');
        } catch {
          reject(new Error('Unexpected response from Ollama.'));
        }
      });
    });
  }

  // Streaming: newline-delimited JSON, one object per token batch, terminated by
  // an object with done:true. Buffer partial lines across data events.
  private async stream(base: string, body: string, onChunk: (c: string) => void): Promise<string> {
    const res = await this.request(base, body);
    return new Promise((resolve, reject) => {
      let full = '';
      let buffer = '';

      const handleLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const obj = JSON.parse(trimmed) as { message?: { content?: string }; error?: string };
          if (obj.error) throw new Error(obj.error);
          const text = obj.message?.content ?? '';
          if (text) { full += text; onChunk(text); }
        } catch (err) {
          if (err instanceof Error && err.message) throw err;
          /* ignore non-JSON / partial */
        }
      };

      res.on('data', (raw: Buffer) => {
        buffer += raw.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';     // keep the last (possibly partial) line
        try {
          for (const line of lines) handleLine(line);
        } catch (err) {
          res.destroy();
          reject(err);
        }
      });
      res.on('end', () => {
        try { handleLine(buffer); } catch (err) { return reject(err); }
        resolve(full);
      });
      res.on('error', reject);
    });
  }
}
