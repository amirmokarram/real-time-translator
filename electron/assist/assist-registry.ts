import { IAssistProvider } from './assist.interface';
import { ClaudeAssistProvider } from './providers/claude-assist.provider';
import { OpenAIAssistProvider } from './providers/openai-assist.provider';
import { OllamaAssistProvider } from './providers/ollama-assist.provider';
import { OpenAICompatibleAssistProvider } from './providers/openai-compatible-assist.provider';
import { EchoAssistProvider } from './providers/echo-assist.provider';

// Cloud providers (Claude, OpenAI) plus local/offline options: Ollama and any
// OpenAI-compatible server (Docker Model Runner, LM Studio, vLLM, llama.cpp…).
export class AssistRegistry {
  private providers = new Map<string, IAssistProvider>();

  constructor() {
    const providers: IAssistProvider[] = [
      new ClaudeAssistProvider(),
      new OpenAIAssistProvider(),
      new OllamaAssistProvider(),
      new OpenAICompatibleAssistProvider(),
    ];
    // E2E only: a deterministic, network-free assist provider for end-to-end tests.
    if (process.env['TRANSLATOR_E2E']) providers.push(new EchoAssistProvider());

    for (const p of providers) this.providers.set(p.id, p);
  }

  get(id: string): IAssistProvider | undefined {
    return this.providers.get(id);
  }
}
