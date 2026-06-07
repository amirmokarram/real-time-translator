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
  // Custom system-prompt base (from settings). Empty/undefined → built-in default.
  systemPrompt?: string;
}

// Credentials/model for one assist call. apiKey is reused from the matching
// translation provider's settings; model is the assist-specific choice.
// endpoint is only used by local providers (Ollama).
export interface AssistProviderSettings {
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

export interface IAssistProvider {
  readonly id: string;
  ask(
    request: AssistRequest,
    settings: AssistProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<string>;
}
