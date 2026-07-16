import { Injectable, inject, signal } from '@angular/core';
import { AudioSource } from '../models/app.models';
import { ElectronBridgeService } from './electron-bridge.service';
import { TranscriptionService } from './transcription.service';

// Chromium-specific constraint shape — not in the standard TypeScript lib
interface ChromiumDesktopConstraints {
  audio: {
    mandatory: {
      chromeMediaSource: 'desktop';
      chromeMediaSourceId?: string;
    };
  };
  video: {
    mandatory: {
      chromeMediaSource: 'desktop';
      chromeMediaSourceId: string;
      maxWidth: number;
      maxHeight: number;
      maxFrameRate: number;
    };
  };
}

interface CaptureResources {
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  frameId: number;
}

@Injectable({ providedIn: 'root' })
export class AudioService {
  private bridge = inject(ElectronBridgeService);
  private transcription = inject(TranscriptionService);

  readonly sources = signal<AudioSource[]>([]);
  readonly selectedSource = signal<AudioSource | null>(null);
  readonly isCapturing = signal(false);
  readonly audioLevel = signal(0);
  readonly captureError = signal<string | null>(null);

  private resources: CaptureResources | null = null;

  async loadSources(): Promise<void> {
    const system = await this.bridge.getAudioSources();
    const microphones = await this.loadMicrophones();
    const sources = [...system, ...microphones];

    this.sources.set(sources);
    if (sources.length > 0 && !this.selectedSource()) {
      // Restore the last-used source when it still exists (mic device ids can
      // change across restarts/replugs — then fall back to System Audio).
      const savedId = (await this.bridge.getSettings()).audio.selectedSourceId;
      const saved = savedId ? sources.find((s) => s.id === savedId) : undefined;
      this.selectedSource.set(saved ?? sources[0]); // System Audio is the default
    }
  }

  // Microphones are a browser concern — enumerate them in the renderer.
  // Device labels are only populated once mic permission has been granted, so
  // we probe with a short-lived getUserMedia first, then fall back to numbered
  // names if labels are still empty (e.g. permission denied).
  private async loadMicrophones(): Promise<AudioSource[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];

    try {
      const probe = await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .catch(() => null);
      probe?.getTracks().forEach((t) => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          id: `mic:${d.deviceId}`,
          name: d.label || `Microphone ${i + 1}`,
          kind: 'microphone' as const,
        }));
    } catch {
      return [];
    }
  }

  async startCapture(): Promise<void> {
    const source = this.selectedSource();
    if (!source || this.isCapturing()) return;
    this.captureError.set(null);

    try {
      const stream = await this.acquireStream(source);
      const context = new AudioContext({ sampleRate: 16000 });
      const mediaSource = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      mediaSource.connect(analyser);

      const frameId = this.startLevelLoop(analyser);
      this.resources = { stream, context, analyser, frameId };

      this.isCapturing.set(true);
      await this.bridge.startCapture(source.id);

      // Start speech recognition on the captured stream
      await this.transcription.start(this.resources!.stream).catch((err: unknown) => {
        this.captureError.set(err instanceof Error ? err.message : String(err));
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.captureError.set(this.humanizeError(msg));
      throw err;
    }
  }

  async stopCapture(): Promise<void> {
    if (!this.isCapturing()) return;

    this.isCapturing.set(false);
    this.audioLevel.set(0);

    if (this.resources) {
      cancelAnimationFrame(this.resources.frameId);
      this.resources.stream.getTracks().forEach((t) => t.stop());
      await this.resources.context.close().catch(() => {});
      this.resources = null;
    }

    this.transcription.stop();
    await this.bridge.stopCapture();
  }

  selectSource(source: AudioSource): void {
    if (this.isCapturing()) return;
    this.selectedSource.set(source);
    // Persist so the pick survives restarts (fire-and-forget; failure is benign).
    void this.bridge.saveSettings({ audio: { selectedSourceId: source.id } });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async acquireStream(source: AudioSource): Promise<MediaStream> {
    // Microphone input — a plain getUserMedia on the chosen device. Works in
    // both Electron and browser dev mode.
    if (source.kind === 'microphone') {
      const deviceId = source.id.replace(/^mic:/, '');
      return navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
    }

    if (!this.bridge.isElectron) {
      // Browser dev mode — fall back to microphone so the audio pipeline can be tested
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false },
      });
    }

    // System audio (Electron): use Chromium's WASAPI loopback (Windows) /
    // CoreAudio loopback (macOS). The video constraint is required — Chromium
    // enforces it for desktop audio capture. We stop video tracks immediately
    // after acquiring the stream. The real screen id is embedded after 'system:'.
    const screenId = source.id.replace(/^system:/, '');
    const constraints: ChromiumDesktopConstraints = {
      audio: {
        mandatory: { chromeMediaSource: 'desktop' },
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenId,
          maxWidth: 1,
          maxHeight: 1,
          maxFrameRate: 1,
        },
      },
    };

    const full = await navigator.mediaDevices.getUserMedia(
      constraints as unknown as MediaStreamConstraints
    );

    // Discard the video track — we only care about the audio loopback
    full.getVideoTracks().forEach((t) => t.stop());
    return new MediaStream(full.getAudioTracks());
  }

  private startLevelLoop(analyser: AnalyserNode): number {
    const buffer = new Float32Array(analyser.frequencyBinCount);

    const loop = (): void => {
      if (!this.isCapturing()) return;

      analyser.getFloatTimeDomainData(buffer);

      // Root Mean Square — gives perceptual loudness
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      const rms = Math.sqrt(sum / buffer.length);

      // Typical speech/audio peaks at ~0.25 RMS — normalize to 0-1
      this.audioLevel.set(Math.min(1, rms * 5));

      requestAnimationFrame(loop);
    };

    return requestAnimationFrame(loop);
  }

  private humanizeError(msg: string): string {
    if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
      return 'Screen recording permission denied. On macOS, grant access in System Settings → Privacy & Security → Screen Recording.';
    }
    if (msg.includes('NotFoundError') || msg.includes('DevicesNotFoundError')) {
      return 'No audio source found for this screen. Try selecting a different source.';
    }
    if (msg.includes('NotReadableError') || msg.includes('TrackStartError')) {
      return 'Could not start audio capture. The source may be in use by another app.';
    }
    return `Audio capture failed: ${msg}`;
  }
}
