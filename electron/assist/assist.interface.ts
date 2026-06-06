// Assist mode — an LLM assistant that answers questions about the captured
// conversation. Separate from translation: it reuses the Claude/OpenAI API keys
// (from translation provider settings) but has its own provider/model choice and
// its own multi-turn chat. Keys & calls stay in the MAIN process.

export interface AssistMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistRequest {
  // Full chat thread so far (oldest first); the last entry is the new question.
  messages: AssistMessage[];
  // Optional transcript block the user selected as context for this thread.
  context?: string;
}

// Credentials/model for one assist call. apiKey is reused from the matching
// translation provider's settings; model is the assist-specific choice.
export interface AssistProviderSettings {
  apiKey?: string;
  model?: string;
}

export interface IAssistProvider {
  readonly id: string;
  ask(
    request: AssistRequest,
    settings: AssistProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<string>;
}

// Shared system prompt — keeps the two providers behaving identically.
export function buildSystemPrompt(context?: string): string {
  const base =
    'You are a helpful assistant embedded in a real-time English→Persian ' +
    'meeting translator used by a Persian speaker. They may ask in Persian or ' +
    'English; reply in the SAME language they used. Be concise and direct. ' +
    'When they ask about the conversation, ground your answer in the provided ' +
    'transcript excerpt.';

  if (!context?.trim()) return base;
  return (
    `${base}\n\n` +
    `--- Selected conversation transcript ---\n${context.trim()}\n` +
    `--- End transcript ---`
  );
}
