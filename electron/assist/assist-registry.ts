import { IAssistProvider } from './assist.interface';
import { ClaudeAssistProvider } from './providers/claude-assist.provider';
import { OpenAIAssistProvider } from './providers/openai-assist.provider';
import { OllamaAssistProvider } from './providers/ollama-assist.provider';
import { OpenAICompatibleAssistProvider } from './providers/openai-compatible-assist.provider';

// Cloud providers (Claude, OpenAI) plus local/offline options: Ollama and any
// OpenAI-compatible server (Docker Model Runner, LM Studio, vLLM, llama.cpp…).
export class AssistRegistry {
  private providers = new Map<string, IAssistProvider>();

  constructor() {
    for (const p of [
      new ClaudeAssistProvider(),
      new OpenAIAssistProvider(),
      new OllamaAssistProvider(),
      new OpenAICompatibleAssistProvider(),
    ]) {
      this.providers.set(p.id, p);
    }
  }

  get(id: string): IAssistProvider | undefined {
    return this.providers.get(id);
  }
}
