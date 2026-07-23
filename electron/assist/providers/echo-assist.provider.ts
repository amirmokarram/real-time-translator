import { AssistProviderSettings, AssistRequest, IAssistProvider } from '../assist.interface';

// Deterministic assist provider used ONLY by end-to-end tests. No network call:
// it echoes the last user message back, streaming it word-by-word so the real
// assist:chunk / assist:complete path is exercised. Registered only when
// process.env.TRANSLATOR_E2E is set.

// Per-token pause while streaming. Small enough that a short answer still
// lands in a few ms, large enough that a long one is observably in progress.
const TOKEN_DELAY_MS = 8;
export class EchoAssistProvider implements IAssistProvider {
  readonly id = 'echo';

  async ask(
    request: AssistRequest,
    _settings: AssistProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const answer = `Echo: ${lastUser?.content ?? ''}`.trim();

    // Spread the tokens over time rather than emitting them in one synchronous
    // burst: a real provider streams gradually, and only a gradual stream
    // exercises the renderer's mid-stream behaviour (scroll following, stop).
    // Non-streaming callers (e.g. the Q-Bank router) pass no onChunk and so
    // pay none of this.
    if (onChunk) {
      for (const token of answer.match(/\S+\s*/g) ?? []) {
        onChunk(token);
        await new Promise((resolve) => setTimeout(resolve, TOKEN_DELAY_MS));
      }
    }

    return answer;
  }
}
