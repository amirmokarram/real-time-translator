import { ProviderSettings } from '../settings-store';

export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  // Custom system prompt for LLM providers (Claude/OpenAI). Empty/undefined →
  // built-in default. Pure MT providers (Google/DeepL/Microsoft/Libre) ignore it.
  systemPrompt?: string;
}

export interface TranslationResult {
  translatedText: string;
  provider: string;
  processingTimeMs: number;
}

export interface ProviderMeta {
  id: string;
  name: string;
  requiresApiKey: boolean;
  supportsStreaming: boolean;
  configFields: ConfigField[];
}

export interface ConfigField {
  key: keyof ProviderSettings;
  label: string;
  type: 'password' | 'text' | 'select' | 'textarea';
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface ITranslationProvider {
  readonly meta: ProviderMeta;
  translate(
    request: TranslationRequest,
    settings: ProviderSettings,
    onChunk?: (chunk: string) => void
  ): Promise<TranslationResult>;
  validate(settings: ProviderSettings): Promise<{ valid: boolean; error?: string }>;
}
