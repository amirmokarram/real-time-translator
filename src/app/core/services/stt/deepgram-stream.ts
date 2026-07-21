import { ISttStream, SttCallbacks, SttStartOptions } from './stt-stream';

interface DeepGramResult {
  type: string; // 'Results' | 'UtteranceEnd' | 'SpeechStarted' | …
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript: string; confidence: number }>;
  };
}

// DeepGram streaming STT: a WebSocket fed WebM/Opus chunks from a MediaRecorder.
// Emits interim words and finalized fragments; owns its own auto-reconnect. The
// sentence-segmentation logic lives in TranscriptionService (via the callbacks).
export class DeepGramStream implements ISttStream {
  private ws: WebSocket | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stream: MediaStream | null = null;
  private opts!: SttStartOptions;
  private cb!: SttCallbacks;
  private active = false;
  private opened = false; // true once the first connection has succeeded

  start(stream: MediaStream, opts: SttStartOptions, cb: SttCallbacks): Promise<void> {
    this.stream = stream;
    this.opts = opts;
    this.cb = cb;
    this.active = true;
    this.opened = false;
    return this.connect();
  }

  stop(): void {
    this.active = false;

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

    this.stream = null;
  }

  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const model = this.opts.model?.trim() || 'nova-3';
      const params = new URLSearchParams({
        model,
        language: this.opts.language.split('-')[0],   // 'en-US' → 'en'
        interim_results: 'true',
        smart_format: 'true',
        // Silence (ms) before declaring end-of-speech. Lower = snappier but more
        // mid-sentence splits; the default 800ms aligns the boundary with real
        // sentence ends. User-tunable via Settings → Speech Recognition.
        endpointing: String(this.opts.endpointingMs ?? 800),
        // Backstop: emit an UtteranceEnd event after this much silence even if
        // speech_final never fired. DeepGram's API floor for this value is 1000ms.
        utterance_end_ms: String(Math.max(1000, this.opts.utteranceEndMs ?? 1000)),
        vad_events: 'true',
      });

      // Custom-vocabulary biasing. The parameter name is model-specific: Nova-3
      // uses `keyterm` (plain terms, no weight); Nova-2 and earlier use the legacy
      // `keywords`. DeepGram caps this at 100 terms. URLSearchParams handles the
      // per-term URL-encoding (spaces, punctuation) for us.
      const terms = (this.opts.keyterms ?? []).slice(0, 100);
      if (terms.length) {
        const param = model.startsWith('nova-3') ? 'keyterm' : 'keywords';
        for (const term of terms) params.append(param, term);
      }

      // DeepGram WebSocket auth uses a subprotocol token — works from browser without custom headers
      const url = `wss://api.deepgram.com/v1/listen?${params}`;
      this.ws = new WebSocket(url, ['token', this.opts.apiKey ?? '']);
      this.ws.binaryType = 'blob';

      this.ws.onopen = () => {
        this.opened = true;
        this.startRecorder(this.stream!);
        resolve();
      };

      this.ws.onerror = () => {
        if (!this.opened) {
          reject(new Error('DeepGram connection failed. Check your API key in Settings → Speech Recognition.'));
        } else {
          this.cb.error('DeepGram connection lost. Reconnecting…');
          this.scheduleReconnect();
        }
      };

      this.ws.onclose = (ev) => {
        if (!this.active) return;
        if (ev.code === 1008) {
          // 1008 = Policy Violation — bad API key
          this.cb.fatal('DeepGram rejected the API key. Check Settings → Speech Recognition.');
          return;
        }
        this.scheduleReconnect();
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as DeepGramResult;

          // UtteranceEnd: silence detected — close out the current utterance.
          if (msg.type === 'UtteranceEnd') {
            this.cb.utteranceEnd();
            return;
          }
          if (msg.type !== 'Results') return;

          const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? '';

          if (msg.is_final) {
            // Finalized fragment (+ whether DeepGram detected end-of-speech).
            this.cb.final(transcript, !!msg.speech_final);
          } else if (transcript) {
            // Interim word(s): live tail for the panel.
            this.cb.interim(transcript);
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
      this.cb.error('Audio recorder error.');
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
      if (!this.active || !this.stream || !this.opts.apiKey?.trim()) return;
      this.stopRecorder();
      this.connect().catch(() => {});
    }, 1500);
  }
}
