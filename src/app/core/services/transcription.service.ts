import { Injectable, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

interface DeepGramResult {
  type: string; // 'Results' | 'UtteranceEnd' | 'SpeechStarted' | …
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript: string; confidence: number }>;
  };
}

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

  private ws: WebSocket | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private currentStream: MediaStream | null = null;
  private currentLang = 'en-US';

  // All finalized text not yet split into a committed sentence. We append each
  // is_final fragment here, then peel off complete sentences (ending in . ! ?)
  // as soon as the next sentence begins — so one row = one grammatical sentence,
  // even when several sentences arrive in a single continuous utterance.
  private pendingFinal = '';
  private sentenceTimer: ReturnType<typeof setTimeout> | null = null;

  // Safety net: commit a trailing fragment that never got terminal punctuation
  // (rare, since smart_format usually adds it) after this much idle time.
  private static readonly SENTENCE_MAX_WAIT_MS = 4000;

  async start(stream: MediaStream, lang = 'en-US'): Promise<void> {
    if (this.isRunning()) return;

    const apiKey = this.settings.settings()?.stt.apiKey?.trim() ?? '';
    if (!apiKey) {
      throw new Error('DeepGram API key is missing. Go to Settings → Speech Recognition to add it.');
    }

    this.currentStream = stream;
    this.currentLang = lang;
    this.error.set(null);

    await this.connect(stream, apiKey, lang);
  }

  stop(): void {
    this.isRunning.set(false);

    // Commit any sentence still buffered so the final words aren't dropped.
    this.flushAll();

    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    this.stopRecorder();

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(1000, 'Stopped by user'); } catch { /* ignore */ }
      this.ws = null;
    }

    this.currentStream = null;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  // Peel every complete sentence that is already followed by the start of the
  // next one. Leaving the trailing (possibly unfinished) sentence in the buffer
  // avoids splitting on a "." that's really a decimal/abbreviation mid-flow.
  private drainSentences(): void {
    const re = /^\s*(.+?[.!?]["')\]]?)\s+(?=\S)/s;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.pendingFinal)) !== null) {
      const sentence = m[1].trim();
      this.pendingFinal = this.pendingFinal.slice(m[0].length);
      if (sentence) this.emitSentence(sentence);
    }
  }

  // DeepGram signalled end-of-speech (speech_final / UtteranceEnd). Drain whole
  // sentences; commit the tail too if it already ends in terminal punctuation,
  // otherwise hold it (to join with the next utterance) under the idle timer.
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
    return /[.!?]["')\]]?\s*$/.test(text);
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
      TranscriptionService.SENTENCE_MAX_WAIT_MS,
    );
  }

  private clearSentenceTimer(): void {
    if (this.sentenceTimer !== null) {
      clearTimeout(this.sentenceTimer);
      this.sentenceTimer = null;
    }
  }

  private connect(stream: MediaStream, apiKey: string, lang: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams({
        model: 'nova-2',
        language: lang.split('-')[0],   // 'en-US' → 'en'
        interim_results: 'true',
        smart_format: 'true',
        // Require ~800ms of silence before declaring end-of-speech. Shorter
        // values (e.g. the 10ms default) fire speech_final on mid-sentence
        // clause pauses, splitting one sentence across multiple rows so each
        // row looks truncated. 800ms aligns the boundary with real sentence ends.
        endpointing: '800',
        // Backstop: emit an UtteranceEnd event after 1s of silence even if
        // speech_final never fired (e.g. continuous speech then a stop).
        utterance_end_ms: '1000',
        vad_events: 'true',
      });

      // DeepGram WebSocket auth uses a subprotocol token — works from browser without custom headers
      const url = `wss://api.deepgram.com/v1/listen?${params}`;
      this.ws = new WebSocket(url, ['token', apiKey]);
      this.ws.binaryType = 'blob';

      this.ws.onopen = () => {
        this.isRunning.set(true);
        this.startRecorder(stream);
        resolve();
      };

      this.ws.onerror = () => {
        if (!this.isRunning()) {
          reject(new Error('DeepGram connection failed. Check your API key in Settings → Speech Recognition.'));
        } else {
          this.error.set('DeepGram connection lost. Reconnecting…');
          this.scheduleReconnect();
        }
      };

      this.ws.onclose = (ev) => {
        if (!this.isRunning()) return;
        if (ev.code === 1008) {
          // 1008 = Policy Violation — bad API key
          this.error.set('DeepGram rejected the API key. Check Settings → Speech Recognition.');
          this.stop();
          return;
        }
        this.scheduleReconnect();
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as DeepGramResult;

          // UtteranceEnd: silence detected — close out the current utterance.
          if (msg.type === 'UtteranceEnd') {
            this.endUtterance();
            return;
          }
          if (msg.type !== 'Results') return;

          const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? '';

          if (msg.is_final) {
            // Finalized fragment → buffer it, then peel off any complete sentences.
            if (transcript) {
              this.pendingFinal = `${this.pendingFinal} ${transcript}`.trim();
              this.drainSentences();
            }
            // speech_final = DeepGram detected end-of-speech → close the utterance.
            if (msg.speech_final) {
              this.endUtterance();
            } else {
              this.interimText.set(this.liveText(''));
            }
          } else if (transcript) {
            // Interim word(s): show uncommitted finalized text + the live tail.
            this.interimText.set(this.liveText(transcript));
          }
        } catch { /* ignore non-JSON frames */ }
      };
    });
  }

  private startRecorder(stream: MediaStream): void {
    const mimeType = this.pickMimeType();

    try {
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
      });
    } catch {
      // Fallback if preferred type not accepted
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.mediaRecorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data.size > 0 && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(ev.data);
      }
    };

    this.mediaRecorder.onerror = () => {
      this.error.set('Audio recorder error.');
    };

    this.mediaRecorder.start(250);   // 250 ms chunks → ~200 ms latency
  }

  private stopRecorder(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch { /* ignore */ }
    }
    this.mediaRecorder = null;
  }

  private pickMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  private scheduleReconnect(): void {
    if (this.restartTimer !== null) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.isRunning() || !this.currentStream) return;
      const apiKey = this.settings.settings()?.stt.apiKey?.trim() ?? '';
      if (!apiKey) return;
      this.stopRecorder();
      this.connect(this.currentStream, apiKey, this.currentLang).catch(() => {});
    }, 1500);
  }
}
