import { ISttStream, SttCallbacks, SttStartOptions } from './stt-stream';

interface WhisperSegment {
  start?: string | number;
  end?: string | number;
  text?: string;
  completed?: boolean;
}

interface WhisperMessage {
  uid?: string;
  message?: string;   // 'SERVER_READY' | 'DISCONNECT' | …
  status?: string;    // 'WAIT' | 'ERROR' | …
  language?: string;  // language-detection frame (ignored)
  segments?: WhisperSegment[];
}

// Whisper streaming STT via a local WhisperLive server. Unlike DeepGram (which
// takes WebM/Opus from a MediaRecorder), WhisperLive wants RAW Float32 PCM at
// 16 kHz mono, so we tap the stream through an AudioContext + ScriptProcessor
// instead. The server does its own sliding-window VAD and returns growing
// segments; `completed` ones are finalized. Owns its own auto-reconnect.
export class WhisperStream implements ISttStream {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  private stream: MediaStream | null = null;
  private opts!: SttStartOptions;
  private cb!: SttCallbacks;
  private active = false;
  private ready = false;          // SERVER_READY received → ok to stream audio
  private opened = false;         // a connection has completed the handshake at least once
  private readonly uid = WhisperStream.makeUid();

  // Watermark: `end` time (seconds) of the last completed segment we've already
  // forwarded. WhisperLive re-sends recent segments, so we only emit beyond this.
  private lastCompletedEnd = -1;

  private static readonly SAMPLE_RATE = 16000;
  private static readonly BUFFER_SIZE = 4096; // ~256 ms chunks at 16 kHz
  // How long to wait for SERVER_READY after the socket opens before giving up.
  // Generous because the very first use of a model triggers a server-side download.
  private static readonly READY_TIMEOUT_MS = 30000;

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
    this.clearReadyTimer();

    this.teardownAudio();

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(1000, 'Stopped by user'); } catch { /* ignore */ }
      this.ws = null;
    }

    this.stream = null;
  }

  // ── Connection ────────────────────────────────────────────────────────────────

  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ready = false;
      this.lastCompletedEnd = -1;

      const endpoint = this.opts.endpoint?.trim() || 'ws://localhost:9090';
      try {
        this.ws = new WebSocket(endpoint);
      } catch {
        reject(new Error('Invalid Whisper endpoint URL. Check Settings → Speech Recognition.'));
        return;
      }
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        // Send the WhisperLive handshake; streaming begins once SERVER_READY lands.
        try {
          this.ws!.send(JSON.stringify({
            uid: this.uid,
            language: this.opts.language.split('-')[0], // 'en-US' → 'en'
            task: 'transcribe',
            model: this.opts.model?.trim() || 'small',
            use_vad: this.opts.useVad ?? true,
          }));
        } catch { /* ignore */ }

        // Guard against a socket that opens but never sends SERVER_READY.
        this.readyTimer = setTimeout(() => {
          this.readyTimer = null;
          if (!this.opened) {
            reject(new Error('Whisper server opened but never became ready (the model may still be downloading). Try again in a moment.'));
          } else {
            this.cb.error('Whisper server stopped responding. Reconnecting…');
            this.scheduleReconnect();
          }
        }, WhisperStream.READY_TIMEOUT_MS);
      };

      this.ws.onerror = () => {
        this.clearReadyTimer();
        if (!this.opened) {
          reject(new Error('Whisper connection failed. Is the WhisperLive server running? Check Settings → Speech Recognition.'));
        } else {
          this.cb.error('Whisper connection lost. Reconnecting…');
          this.scheduleReconnect();
        }
      };

      this.ws.onclose = () => {
        this.clearReadyTimer();
        if (!this.active) return;
        this.scheduleReconnect();
      };

      this.ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return; // we only receive JSON frames
        let msg: WhisperMessage;
        try {
          msg = JSON.parse(ev.data) as WhisperMessage;
        } catch {
          return;
        }
        if (msg.uid && msg.uid !== this.uid) return; // not for us

        if (msg.message === 'SERVER_READY') {
          this.clearReadyTimer();
          this.opened = true;
          this.ready = true;
          this.startAudio();
          resolve();
          return;
        }
        if (msg.status === 'WAIT') {
          this.cb.error('Whisper server is busy — waiting for a free slot…');
          return;
        }
        if (msg.message === 'DISCONNECT') {
          // Server is closing our slot; onclose will follow and trigger reconnect.
          return;
        }
        if (msg.segments?.length) {
          this.handleSegments(msg.segments);
        }
      };
    });
  }

  // ── Segment → callbacks ─────────────────────────────────────────────────────

  // WhisperLive sends a growing list of recent segments. Emit each newly-completed
  // one as a finalized utterance (dedup by `end` time); show the trailing
  // in-progress segment as interim. Each completed segment ≈ one committed row.
  private handleSegments(segments: WhisperSegment[]): void {
    let interim = '';
    segments.forEach((seg, i) => {
      const text = (seg.text ?? '').trim();
      const end = WhisperStream.toNum(seg.end);
      const isFinal = seg.completed === true || (seg.completed === undefined && i < segments.length - 1);

      if (isFinal) {
        if (text && end > this.lastCompletedEnd) {
          this.lastCompletedEnd = end;
          this.cb.final(text, true);
        }
      } else if (text) {
        interim = text;
      }
    });
    this.cb.interim(interim);
  }

  // ── Audio: raw Float32 PCM @ 16 kHz ──────────────────────────────────────────

  private startAudio(): void {
    if (this.ctx || !this.stream) return; // already running

    this.ctx = new AudioContext({ sampleRate: WhisperStream.SAMPLE_RATE });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(WhisperStream.BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (ev: AudioProcessingEvent) => {
      if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      // Copy out of the reused buffer and send the raw little-endian float32 bytes.
      this.ws.send(new Float32Array(input).buffer);
    };

    // source → processor → destination. The processor writes no output, so the
    // destination stays silent (no echo of the captured system audio).
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  }

  private teardownAudio(): void {
    this.ready = false;
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try { this.processor.disconnect(); } catch { /* ignore */ }
      this.processor = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch { /* ignore */ }
      this.source = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.restartTimer !== null) return;
    this.clearReadyTimer();
    this.teardownAudio();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.active || !this.stream) return;
      this.connect().catch(() => {});
    }, 1500);
  }

  private static toNum(v: string | number | undefined): number {
    const n = typeof v === 'string' ? parseFloat(v) : v ?? 0;
    return Number.isFinite(n) ? (n as number) : 0;
  }

  private static makeUid(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `rtt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    }
  }
}
