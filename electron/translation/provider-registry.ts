import { ITranslationProvider, ProviderMeta } from './provider.interface';
import { ClaudeProvider } from './providers/claude.provider';
import { GoogleProvider } from './providers/google.provider';
import { DeepLProvider } from './providers/deepl.provider';
import { MicrosoftProvider } from './providers/microsoft.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { LibreTranslateProvider } from './providers/libretranslate.provider';

export class ProviderRegistry {
  private providers = new Map<string, ITranslationProvider>();

  constructor() {
    for (const p of [
      new ClaudeProvider(),
      new GoogleProvider(),
      new DeepLProvider(),
      new MicrosoftProvider(),
      new OpenAIProvider(),
      new LibreTranslateProvider(),
    ]) {
      this.providers.set(p.meta.id, p);
    }
  }

  get(id: string): ITranslationProvider | undefined {
    return this.providers.get(id);
  }

  getAllMeta(): ProviderMeta[] {
    return [...this.providers.values()].map((p) => p.meta);
  }
}
