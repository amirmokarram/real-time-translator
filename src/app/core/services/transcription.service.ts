import { Injectable, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

interface DeepGramResult {
  type: string;
  is_final: boolean;
  speech_final: boolean;
  channel?: {
    alternatives?: Array<{ transcript: string; confidence: number }>;
  };
}

@Injectable({ providedIn: 'root' })
export class TranscriptionService {
  private settings = inject(SettingsService);

  readonly isRunning = signal(false);
  readonly interimText = signal('');
  readonly lastFinalText = signal('');
  readonly error = signal<string | null>(null);

  private ws: WebSocket | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private currentStream: MediaStream | null = null;
  private currentLang = 'en-US';

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
    this.interimText.set('');

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

  private connect(stream: MediaStream, apiKey: string, lang: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams({
        model: 'nova-2',
        language: lang.split('-')[0],   // 'en-US' → 'en'
        interim_results: 'true',
        smart_format: 'true',
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
          if (msg.type !== 'Results') return;

          const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
          if (!transcript) return;

          if (msg.is_final) {
            this.lastFinalText.set(transcript);
            this.interimText.set('');
          } else {
            this.interimText.set(transcript);
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
