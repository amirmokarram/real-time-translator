import { AssistProviderSettings, AssistRequest, IAssistProvider } from '../assist.interface';

// Deterministic assist provider used ONLY by end-to-end tests. No network call:
// it echoes the last user message back, streaming it word-by-word so the real
// assist:chunk / assist:complete path is exercised. Registered only when
// process.env.TRANSLATOR_E2E is set.
export class EchoAssistProvider implements IAssistProvider {
  readonly id = 'echo';

  async ask(
    request: AssistRequest,
    _settings: AssistProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const answer = `Echo: ${lastUser?.content ?? ''}`.trim();

    if (onChunk) {
      for (const token of answer.match(/\S+\s*/g) ?? []) onChunk(token);
    }

    return answer;
  }
}
