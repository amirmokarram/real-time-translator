import Anthropic from '@anthropic-ai/sdk';
import {
  AssistProviderSettings,
  AssistRequest,
  IAssistProvider,
} from '../assist.interface';
import { composeAssistPrompt } from '../../prompts';

export class ClaudeAssistProvider implements IAssistProvider {
  readonly id = 'claude';

  async ask(
    request: AssistRequest,
    settings: AssistProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    if (!settings.apiKey) throw new Error('Claude API key is required (set it in Settings → Claude).');

    const client = new Anthropic({ apiKey: settings.apiKey });
    const model = settings.model ?? 'claude-sonnet-4-6';
    const system = composeAssistPrompt(request.systemPrompt, request.context);
    const messages = request.messages.map((m) => ({ role: m.role, content: m.content }));

    let full = '';

    if (onChunk) {
      const stream = client.messages.stream({ model, max_tokens: 2048, system, messages });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          full += event.delta.text;
          onChunk(event.delta.text);
        }
      }
    } else {
      const response = await client.messages.create({ model, max_tokens: 2048, system, messages });
      full = response.content[0].type === 'text' ? response.content[0].text : '';
    }

    return full;
  }
}
