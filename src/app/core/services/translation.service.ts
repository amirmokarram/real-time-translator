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

  // Live partial preview: the Persian for the in-progress (un-committed) sentence,
  // revised as more words arrive. Cleared when the sentence commits to history.
  readonly livePersian = signal('');
  // Monotonic id so a slow partial response can't overwrite a newer one (or a commit).
  private partialGen = 0;

  private unsubChunk: (() => void) | null = null;

  // `confidence` is the STT backend's certainty in `englishText` (absent for typed
  // input). Carried onto the entry purely so the UI can flag a shaky row.
  // `startedAt` is when the speech began — it outlives this call as the anchor a
  // session recording is seeked by.
  async translate(
    englishText: string,
    confidence?: number,
    startedAt?: number
  ): Promise<TranslationResult> {
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
        source: englishText,
        target: result.translatedText,
        provider: result.provider,
        processingTimeMs: result.processingTimeMs,
        timestamp: new Date(),
        confidence,
        startedAt,
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

  // Translate in-progress speech for the live preview. Best-effort: errors are
  // swallowed (the committed row surfaces real failures), and a stale response is
  // dropped if a newer partial — or a commit via clearLivePartial() — has since run.
  async translatePartial(englishText: string): Promise<void> {
    const text = englishText.trim();
    if (!text) { this.livePersian.set(''); return; }

    const gen = ++this.partialGen;
    const providerId = this.settings.activeProvider();
    try {
      const result = await this.bridge.translatePartial({ text, providerId });
      if (gen === this.partialGen) this.livePersian.set(result.translatedText);
    } catch {
      /* preview is best-effort — ignore */
    }
  }

  // Drop the live preview and invalidate any in-flight partial (called when the
  // sentence commits to history, or capture stops).
  clearLivePartial(): void {
    this.partialGen++;
    this.livePersian.set('');
  }

  clearHistory(): void {
    this.history.set([]);
  }
}
