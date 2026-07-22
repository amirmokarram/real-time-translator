import { Injectable, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';
import { ISttStream, SttCallbacks } from './stt/stt-stream';
import { DeepGramStream } from './stt/deepgram-stream';
import { WhisperStream } from './stt/whisper-stream';
import { MockSttStream } from './stt/mock-stream';

/** One committed sentence, plus the backend's confidence in it when reported. */
export interface PendingSentence {
  text: string;
  confidence?: number;
  /**
   * Epoch ms when this sentence STARTED being recognized — not when it was
   * committed. Seeking a recording needs the moment the words were spoken, and a
   * sentence is only finalized a second or more after the speaker began it.
   */
  startedAt?: number;
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
  private pendingSentences: PendingSentence[] = [];

  takePending(): PendingSentence[] {
    const out = this.pendingSentences;
    this.pendingSentences = [];
    return out;
  }

  // ── Recognition-quality stats (per capture session) ──────────────────────────
  // Diagnostic only: nothing is gated on these. They exist so a change to the STT
  // config (model, bitrate, custom vocabulary) can be judged against a number
  // rather than a vibe. Comparable only within one backend — confidence scales
  // differ between models.
  readonly avgConfidence = signal<number | null>(null);
  readonly lowConfidenceCount = signal(0);
  private confidenceSum = 0;
  private confidenceCount = 0;
  /** Below this, a sentence is worth eyeballing (and its odd words worth adding to custom vocabulary). */
  static readonly LOW_CONFIDENCE = 0.85;

  // Worst confidence seen among the fragments currently sitting in `pendingFinal`.
  // Fragments don't map cleanly onto sentences after segmentation, so we attach
  // the worst-case value — a sentence is only as trustworthy as its shakiest part.
  private bufferConfidence: number | null = null;

  // Start time of every word still sitting in `pendingFinal`, in order. A sentence
  // takes the time of its FIRST word, and its words are dropped as it commits.
  //
  // Per-fragment timing is not enough on its own: one finalized fragment routinely
  // contains several sentences, which would then all claim the fragment's start and
  // land on the same instant in the recording — clicking any of them plays the
  // first, and anything keyed by that timestamp collides across rows.
  private pendingWords: number[] = [];

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
  private boundaryRe = TranscriptionService.buildBoundaryRe(false);
  private endsRe = TranscriptionService.buildEndsRe(false);

  // Every candidate row break in the buffer: punctuation (plus an optional closing
  // quote/bracket) that is followed by whitespace. Global — findSentenceEnd walks
  // the candidates and lets `isRealBoundary` veto the ones that only look like one.
  private static buildBoundaryRe(clause: boolean): RegExp {
    const p = clause ? '.!?,;:' : '.!?';
    return new RegExp(`[${p}]["')\\]]?(?=\\s)`, 'g');
  }
  private static buildEndsRe(clause: boolean): RegExp {
    const p = clause ? '.!?,;:' : '.!?';
    return new RegExp(`[${p}]["')\\]]?\\s*$`);
  }

  // ── What actually counts as a sentence end ────────────────────────────────────
  // The last whitespace-delimited token of a candidate sentence, so its final "."
  // can be vetted. Clause punctuation is never ambiguous, so only "." is checked.
  private static readonly LAST_TOKEN_RE = /(\S+)\s*$/;

  // Tokens ending in "." that don't end a sentence. Deliberately not exhaustive,
  // and deliberately free of words that also stand alone ("no.", "al.") — a miss
  // costs one wrong split, a false positive glues two real sentences together.
  private static readonly ABBREVIATIONS = new Set([
    'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.', 'mt.', 'ft.',
    'vs.', 'etc.', 'inc.', 'ltd.', 'co.', 'corp.', 'dept.', 'est.', 'approx.',
    'fig.', 'vol.', 'ave.', 'rd.', 'blvd.',
    'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.',
    'oct.', 'nov.', 'dec.',
  ]);

  // Does `text` (a candidate sentence, ending exactly at its punctuation) really
  // end there? Only a "." can lie.
  private static isRealBoundary(text: string): boolean {
    if (!text.endsWith('.')) return true;
    const token = TranscriptionService.LAST_TOKEN_RE.exec(text)?.[1] ?? '';
    const t = token.replace(/^["'(\[]+/, '').toLowerCase();
    if (TranscriptionService.ABBREVIATIONS.has(t)) return false;
    // Note there is no decimal rule: a boundary candidate must have whitespace
    // after the dot, and "1.5"/"v1.2" don't — so a number that ends a sentence
    // ("I have 25.", which `numerals=true` produces constantly) stays a boundary.
    //
    // Initials and dotted initialisms — "J.", "e.g.", "U.S.A.": a single letter
    // sitting at the start or after a dot never ends a sentence.
    if (/(^|\.)[a-z]\.$/.test(t)) return false;
    return true;
  }

  // Custom-vocabulary field → clean term list. Users type one term per line (or
  // comma-separated); we split on both, trim, drop blanks, and dedupe. The
  // backend caps the count, so order (not length) is all we preserve here.
  private static parseKeyterms(raw: string | undefined): string[] {
    if (!raw?.trim()) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const term of raw.split(/[\n,]/)) {
      const t = term.trim();
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        out.push(t);
      }
    }
    return out;
  }

  // Semantic events from whichever backend is streaming. The protocol-specific
  // parsing lives in the strategy; here we only do sentence segmentation.
  private readonly callbacks: SttCallbacks = {
    final: ({ text, endOfUtterance, confidence, startedAt, wordStartedAt }) => {
      if (text) {
        if (confidence !== undefined) {
          this.bufferConfidence =
            this.bufferConfidence === null ? confidence : Math.min(this.bufferConfidence, confidence);
        }
        // One entry per word, so a sentence peeled from the middle of this
        // fragment still knows when it started. Backends without word timings
        // (Whisper, the E2E mock) fall back to one time for the whole fragment.
        const fallback = startedAt ?? Date.now();
        const words = TranscriptionService.countWords(text);
        for (let i = 0; i < words; i++) {
          this.pendingWords.push(wordStartedAt?.[i] ?? fallback);
        }
        this.pendingFinal = `${this.pendingFinal} ${text}`.trim();
        this.drainSentences();
        this.commitCompleteTail();
      }
      if (endOfUtterance) this.endUtterance();
      else this.interimText.set(this.liveText(''));
    },
    interim: (text) => this.interimText.set(this.liveText(text)),
    utteranceEnd: () => this.endUtterance(),
    error: (message) => this.error.set(message),
    fatal: (message) => { this.error.set(message); this.stop(); },
  };

  async start(stream: MediaStream): Promise<void> {
    if (this.isRunning()) return;

    const appSettings = this.settings.settings();
    const stt = appSettings?.stt;
    // The source language drives speech recognition (ISO-639-1; each backend
    // narrows it as needed). Falls back to English if settings aren't loaded.
    const lang = appSettings?.languages.source ?? 'en';
    this.error.set(null);

    // Fresh quality stats per capture session, so an A/B of STT settings compares
    // like with like instead of averaging across the previous configuration.
    this.avgConfidence.set(null);
    this.lowConfidenceCount.set(0);
    this.confidenceSum = 0;
    this.confidenceCount = 0;
    this.bufferConfidence = null;
    this.pendingWords = [];

    // Apply latency-tuning knobs for this session.
    this.sentenceMaxWaitMs = stt?.sentenceMaxWaitMs ?? 4000;
    const clause = stt?.commitOnClause ?? false;
    this.boundaryRe = TranscriptionService.buildBoundaryRe(clause);
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
        {
          language: lang,
          apiKey,
          model: stt?.deepgramModel,
          keyterms: TranscriptionService.parseKeyterms(stt?.keyterms),
          audioBitrateKbps: stt?.audioBitrateKbps,
          endpointingMs: stt?.endpointingMs,
          utteranceEndMs: stt?.utteranceEndMs,
        },
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
  // next one. The trailing sentence stays in the buffer — commitCompleteTail
  // releases it immediately when its punctuation is unambiguous, otherwise the
  // utterance end or the idle timer does.
  private drainSentences(): void {
    for (;;) {
      const end = this.findSentenceEnd(this.pendingFinal);
      if (end === -1) return;
      const sentence = this.pendingFinal.slice(0, end).trim();
      // The sentence starts at the front of the buffer, so its first word is the
      // first pending one. Read before consuming.
      const startedAt = this.pendingWords[0];
      this.pendingFinal = this.pendingFinal.slice(end).trimStart();
      this.pendingWords.splice(0, TranscriptionService.countWords(sentence));
      if (!sentence) return;
      this.emitSentence(sentence, startedAt);
    }
  }

  // Index just past the first real sentence boundary in `text`, or -1 if there
  // isn't one yet. Candidates that turn out to be an abbreviation, a decimal or an
  // initial are skipped, so "I met Dr. Smith today." stays a single row.
  private findSentenceEnd(text: string): number {
    const re = this.boundaryRe;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const end = m.index + m[0].length;
      // Nothing but whitespace left → this is the trailing sentence; leave it in
      // the buffer for commitCompleteTail (or the utterance end) to decide on.
      if (!/\S/.test(text.slice(end))) return -1;
      if (TranscriptionService.isRealBoundary(text.slice(0, end))) return end;
    }
    return -1;
  }

  private static countWords(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
  }

  // `drainSentences` only peels a sentence once the NEXT one has started arriving,
  // which costs the trailing — and freshest — sentence the whole endpointing
  // silence (~800ms-1s) before it reaches translation, even though the speaker
  // clearly finished it. So commit the tail as soon as it ends in unambiguous
  // sentence-terminal punctuation, and let only the ambiguous cases keep waiting.
  //
  // Sentence-terminal even under commitOnClause: a fragment ending on a comma is
  // mid-thought by definition, so there is nothing to gain by rushing it.
  private static readonly TERMINAL_TAIL_RE = /[.!?]["')\]]?\s*$/;

  private commitCompleteTail(): void {
    const tail = this.pendingFinal.trim();
    if (!tail) return;
    if (!TranscriptionService.TERMINAL_TAIL_RE.test(tail)) return;
    if (!TranscriptionService.isRealBoundary(tail)) return;
    this.commitRemainder();
  }

  // Backend signalled end-of-speech. Drain whole sentences; commit the tail too
  // if it already ends in terminal punctuation, otherwise hold it (to join with
  // the next utterance) under the idle timer. No abbreviation vetting here: the
  // speaker actually stopped talking, which outweighs what the punctuation looks
  // like — nothing is coming to complete "I met Dr." anyway.
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
    const startedAt = this.pendingWords[0];
    this.pendingFinal = '';
    this.pendingWords = [];
    this.interimText.set('');
    if (sentence) this.emitSentence(sentence, startedAt);
  }

  // Queue a finished sentence for the consumer and update the display fallback.
  private emitSentence(sentence: string, startedAt?: number): void {
    const confidence = this.bufferConfidence ?? undefined;
    this.pendingSentences.push({ text: sentence, confidence, startedAt });
    this.lastFinalText.set(sentence);
    this.finalVersion.update((v) => v + 1);

    if (confidence !== undefined) {
      this.confidenceSum += confidence;
      this.confidenceCount += 1;
      this.avgConfidence.set(this.confidenceSum / this.confidenceCount);
      if (confidence < TranscriptionService.LOW_CONFIDENCE) {
        this.lowConfidenceCount.update((n) => n + 1);
      }
    }

    // Buffer drained → the next sentence starts its own confidence window.
    if (!this.pendingFinal.trim()) this.bufferConfidence = null;
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
