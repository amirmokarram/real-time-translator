import { Injectable, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';
import { ISttStream, SttCallbacks } from './stt/stt-stream';
import { DeepGramStream } from './stt/deepgram-stream';
import { WhisperStream } from './stt/whisper-stream';
import { MockSttStream } from './stt/mock-stream';

@Injectable({ providedIn: 'root' })
export class TranscriptionService {
  private settings = inject(SettingsService);

  readonly isRunning = signal(false);
  readonly interimText = signal('');
  readonly lastFinalText = signal(''); // last committed sentence — for live-panel display only
  readonly error = signal<string | null>(null);

  // Bumped whenever ≥1 new sentence is queued. The consumer reacts to this and
  // drains takePending(); using a queue (not the value of lastFinalText) means
  // a burst of sentences committed in one tick is never lost to signal coalescing.
  readonly finalVersion = signal(0);
  private pendingSentences: string[] = [];

  takePending(): string[] {
    const out = this.pendingSentences;
    this.pendingSentences = [];
    return out;
  }

  // The active streaming backend (DeepGram today; Whisper added in Phase C).
  private stream: ISttStream | null = null;

  // All finalized text not yet split into a committed sentence. We append each
  // final fragment here, then peel off complete sentences (ending in . ! ?)
  // as soon as the next sentence begins — so one row = one grammatical sentence,
  // even when several sentences arrive in a single continuous utterance.
  private pendingFinal = '';
  private sentenceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Latency tuning (configured from settings in start()) ───────────────────────
  // Safety net: commit a trailing fragment that never got terminal punctuation
  // (rare, since smart_format usually adds it) after this much idle time.
  private sentenceMaxWaitMs = 4000;
  // Punctuation that ends a row. Default is sentence-terminal only; with
  // commitOnClause the user also splits on clause punctuation for snappier rows.
  private sentenceRe = TranscriptionService.buildSentenceRe(false);
  private endsRe = TranscriptionService.buildEndsRe(false);

  private static buildSentenceRe(clause: boolean): RegExp {
    const p = clause ? '.!?,;:' : '.!?';
    return new RegExp(`^\\s*(.+?[${p}]["')\\]]?)\\s+(?=\\S)`, 's');
  }
  private static buildEndsRe(clause: boolean): RegExp {
    const p = clause ? '.!?,;:' : '.!?';
    return new RegExp(`[${p}]["')\\]]?\\s*$`);
  }

  // Semantic events from whichever backend is streaming. The protocol-specific
  // parsing lives in the strategy; here we only do sentence segmentation.
  private readonly callbacks: SttCallbacks = {
    final: (text, endOfUtterance) => {
      if (text) {
        this.pendingFinal = `${this.pendingFinal} ${text}`.trim();
        this.drainSentences();
      }
      if (endOfUtterance) this.endUtterance();
      else this.interimText.set(this.liveText(''));
    },
    interim: (text) => this.interimText.set(this.liveText(text)),
    utteranceEnd: () => this.endUtterance(),
    error: (message) => this.error.set(message),
    fatal: (message) => { this.error.set(message); this.stop(); },
  };

  async start(stream: MediaStream, lang = 'en-US'): Promise<void> {
    if (this.isRunning()) return;

    const stt = this.settings.settings()?.stt;
    this.error.set(null);

    // Apply latency-tuning knobs for this session.
    this.sentenceMaxWaitMs = stt?.sentenceMaxWaitMs ?? 4000;
    const clause = stt?.commitOnClause ?? false;
    this.sentenceRe = TranscriptionService.buildSentenceRe(clause);
    this.endsRe = TranscriptionService.buildEndsRe(clause);

    if (stt?.provider === 'mock') {
      // E2E only: a scripted backend driven by test DOM events (never set by the UI).
      this.stream = new MockSttStream();
      await this.stream.start(stream, { language: lang }, this.callbacks);
    } else if (stt?.provider === 'whisper') {
      const endpoint = stt.endpoint?.trim() ?? '';
      if (!endpoint) {
        throw new Error('Whisper server endpoint is missing. Go to Settings → Speech Recognition to set it.');
      }
      this.stream = new WhisperStream();
      await this.stream.start(
        stream,
        { language: lang, endpoint, model: stt.model, useVad: stt.useVad },
        this.callbacks,
      );
    } else {
      const apiKey = stt?.apiKey?.trim() ?? '';
      if (!apiKey) {
        throw new Error('DeepGram API key is missing. Go to Settings → Speech Recognition to add it.');
      }
      this.stream = new DeepGramStream();
      await this.stream.start(
        stream,
        { language: lang, apiKey, endpointingMs: stt?.endpointingMs, utteranceEndMs: stt?.utteranceEndMs },
        this.callbacks,
      );
    }

    this.isRunning.set(true);
  }

  stop(): void {
    this.isRunning.set(false);

    // Commit any sentence still buffered so the final words aren't dropped.
    this.flushAll();

    this.stream?.stop();
    this.stream = null;
  }

  // ── Sentence segmentation ─────────────────────────────────────────────────────

  // Peel every complete sentence that is already followed by the start of the
  // next one. Leaving the trailing (possibly unfinished) sentence in the buffer
  // avoids splitting on a "." that's really a decimal/abbreviation mid-flow.
  private drainSentences(): void {
    const re = this.sentenceRe;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.pendingFinal)) !== null) {
      const sentence = m[1].trim();
      this.pendingFinal = this.pendingFinal.slice(m[0].length);
      if (sentence) this.emitSentence(sentence);
    }
  }

  // Backend signalled end-of-speech. Drain whole sentences; commit the tail too
  // if it already ends in terminal punctuation, otherwise hold it (to join with
  // the next utterance) under the idle timer.
  private endUtterance(): void {
    this.drainSentences();
    const tail = this.pendingFinal.trim();
    if (!tail) {
      this.clearSentenceTimer();
      this.interimText.set('');
      return;
    }
    if (this.endsSentence(tail)) {
      this.commitRemainder();
    } else {
      this.interimText.set(tail);
      this.armSentenceTimer();
    }
  }

  // Commit whatever remains in the buffer as one sentence (ignores punctuation).
  private commitRemainder(): void {
    this.clearSentenceTimer();
    const sentence = this.pendingFinal.trim();
    this.pendingFinal = '';
    this.interimText.set('');
    if (sentence) this.emitSentence(sentence);
  }

  // Queue a finished sentence for the consumer and update the display fallback.
  private emitSentence(sentence: string): void {
    this.pendingSentences.push(sentence);
    this.lastFinalText.set(sentence);
    this.finalVersion.update((v) => v + 1);
  }

  private endsSentence(text: string): boolean {
    // Allow a trailing closing quote/bracket after the punctuation.
    return this.endsRe.test(text);
  }

  // The live English line = uncommitted finalized text plus the in-flight tail.
  private liveText(tail: string): string {
    return `${this.pendingFinal} ${tail}`.trim();
  }

  // Force-commit everything buffered, ignoring punctuation (used on stop).
  private flushAll(): void {
    this.drainSentences();
    this.commitRemainder();
  }

  private armSentenceTimer(): void {
    this.clearSentenceTimer();
    this.sentenceTimer = setTimeout(
      () => this.commitRemainder(),
      this.sentenceMaxWaitMs,
    );
  }

  private clearSentenceTimer(): void {
    if (this.sentenceTimer !== null) {
      clearTimeout(this.sentenceTimer);
      this.sentenceTimer = null;
    }
  }
}
