import { Injectable, inject, signal } from '@angular/core';
import { TranslationEntry, TranslationResult } from '../models/app.models';
import { ElectronBridgeService } from './electron-bridge.service';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private bridge = inject(ElectronBridgeService);
  private settings = inject(SettingsService);

  readonly isTranslating = signal(false);
  readonly streamingPersian = signal('');
  readonly history = signal<TranslationEntry[]>([]);

  private unsubChunk: (() => void) | null = null;

  async translate(englishText: string): Promise<TranslationResult> {
    if (!englishText.trim()) throw new Error('Empty input');

    this.isTranslating.set(true);
    this.streamingPersian.set('');

    const providerId = this.settings.activeProvider();
    const providerMeta = this.settings.providerMeta(providerId);
    const streaming = providerMeta?.supportsStreaming ?? false;

    if (streaming) {
      this.unsubChunk = this.bridge.onTranslationChunk((chunk) => {
        this.streamingPersian.update((s) => s + chunk);
      });
    }

    try {
      const result = await this.bridge.translate({ text: englishText, providerId });

      const entry: TranslationEntry = {
        id: crypto.randomUUID(),
        english: englishText,
        persian: result.translatedText,
        provider: result.provider,
        processingTimeMs: result.processingTimeMs,
        timestamp: new Date(),
      };

      // Add newest at the END so history scrolls upward naturally
      this.history.update((h) => {
        const max = this.settings.settings()?.display.historyLength ?? 50;
        return [...h, entry].slice(-max);
      });

      // Brief display in the live panel before clearing (history now holds it)
      this.streamingPersian.set(result.translatedText);
      setTimeout(() => this.streamingPersian.set(''), 600);

      return result;
    } finally {
      this.unsubChunk?.();
      this.unsubChunk = null;
      this.isTranslating.set(false);
    }
  }

  clearHistory(): void {
    this.history.set([]);
  }
}
