import { IAssistProvider } from './assist.interface';
import { ClaudeAssistProvider } from './providers/claude-assist.provider';
import { OpenAIAssistProvider } from './providers/openai-assist.provider';

// Only cloud LLM providers can power assist mode. (Ollama can be added here
// later as an offline option without touching the rest of the pipeline.)
export class AssistRegistry {
  private providers = new Map<string, IAssistProvider>();

  constructor() {
    for (const p of [new ClaudeAssistProvider(), new OpenAIAssistProvider()]) {
      this.providers.set(p.id, p);
    }
  }

  get(id: string): IAssistProvider | undefined {
    return this.providers.get(id);
  }
}
