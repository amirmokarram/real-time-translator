import { Injectable, inject, signal } from '@angular/core';
import {
  AudioSource,
  RecordingTrack,
  SessionTranscript,
  TranslationEntry,
} from '../models/app.models';
import { ElectronBridgeService } from './electron-bridge.service';
import { SettingsService } from './settings.service';

// How often the MediaRecorder hands us a blob. Bounds what a crash can cost —
// anything already flushed is on disk — without generating needless IPC traffic.
const CHUNK_MS = 5000;

interface TrackRecorder {
  track: RecordingTrack;
  recorder: MediaRecorder;
}

/**
 * Records the session audio to disk, alongside (and independently of) speech
 * recognition.
 *
 * Two things are deliberate here:
 *
 * 1. **Its own MediaRecorder.** `DeepGramStream` stops and rebuilds its recorder
 *    on every reconnect, so a recording sharing it would silently lose the audio
 *    around each blip. This one is started once per capture session.
 *
 * 2. **The mixed stream never reaches the recognizer.** Mixing the microphone in
 *    is a recording-only concern; `TranscriptionService` keeps receiving the raw
 *    captured stream, so the user's own voice is never transcribed and translated
 *    back at them.
 *
 * Recording is always the secondary job: every failure here is reported and
 * swallowed so that capture and translation carry on.
 */
@Injectable({ providedIn: 'root' })
export class RecordingService {
  private bridge = inject(ElectronBridgeService);
  private settings = inject(SettingsService);

  readonly isRecording = signal(false);
  readonly startedAt = signal<number | null>(null);
  readonly elapsedMs = signal(0);
  /** Non-fatal problem (mic unavailable, disk write failed) — shown as a banner. */
  readonly error = signal<string | null>(null);

  /**
   * The session that was just recorded, kept after stop() until its transcript is
   * filed. Also the anchor the SRT export zeroes on, so exported subtitles line up
   * with the audio rather than with the first translated line.
   */
  readonly lastSession = signal<{ startedAt: number; durationMs: number } | null>(null);

  private recorders: TrackRecorder[] = [];
  private micStream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private micGain: GainNode | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  // Every chunk write is appended to this chain rather than fired off in
  // parallel. Two reasons, both correctness rather than tidiness: the reads
  // (`blob.arrayBuffer()`) can resolve out of order and interleave chunks into a
  // corrupt WebM, and awaiting the chain on stop is what guarantees the final
  // chunk reaches disk before the file is closed.
  private writeChain: Promise<void> = Promise.resolve();

  /**
   * Begin recording the current capture session. Never throws: a recording that
   * can't start must not take audio capture down with it.
   */
  async start(captured: MediaStream, source: AudioSource): Promise<void> {
    const cfg = this.settings.settings()?.recording;
    if (!cfg?.enabled || this.isRecording() || !this.bridge.isElectron) return;

    this.error.set(null);
    this.writeChain = Promise.resolve();
    this.lastSession.set(null); // a new session supersedes the previous anchor

    try {
      // Mixing a mic only makes sense when capturing system audio — when the user
      // is already capturing a microphone, that voice is in the stream already.
      const wantsMic = cfg.mode !== 'source' && source.kind === 'system';
      const mic = wantsMic ? await this.openMic(cfg.micDeviceId) : null;
      this.micStream = mic; // held so teardown can release the device

      const separate = cfg.mode === 'separate' && !!mic;
      const tracks: RecordingTrack[] = separate ? ['main', 'mic'] : ['main'];
      await this.bridge.recordingStart(tracks);

      const bitsPerSecond = (cfg.bitrateKbps || 64) * 1000;
      if (separate) {
        this.addRecorder('main', captured, bitsPerSecond);
        this.addRecorder('mic', mic!, bitsPerSecond);
      } else {
        const stream = mic ? this.mix(captured, mic, cfg.micGain) : captured;
        this.addRecorder('main', stream, bitsPerSecond);
      }

      this.startedAt.set(Date.now());
      this.elapsedMs.set(0);
      this.isRecording.set(true);
      this.tickTimer = setInterval(() => {
        const started = this.startedAt();
        if (started !== null) this.elapsedMs.set(Date.now() - started);
      }, 1000);
    } catch (err: unknown) {
      this.error.set(`Recording could not start: ${RecordingService.message(err)}`);
      await this.teardown();
    }
  }

  /** Stop recording and close the file(s). Idempotent. */
  async stop(): Promise<void> {
    if (!this.isRecording()) return;

    // Publish the session anchor SYNCHRONOUSLY, before any await: whoever reacts
    // to capture stopping needs it, and they must not race the flush below.
    // durationMs is wall-clock — the WebM we streamed to disk has no usable
    // duration in its header, so this is the only figure a player can scrub by.
    const started = this.startedAt();
    if (started !== null) {
      this.lastSession.set({ startedAt: started, durationMs: Date.now() - started });
    }

    // Ask each recorder for whatever it is still holding, then drain the write
    // chain — that final chunk is queued during stop(), so the file must not be
    // closed until it has actually been written.
    await Promise.all(this.recorders.map((r) => RecordingService.finish(r.recorder)));
    await this.writeChain.catch(() => {});

    await this.teardown();
  }

  /**
   * File the transcript next to the audio. Called after capture has stopped and
   * the closing sentence has finished translating — offsets are computed from
   * each entry's speech-start time, relative to when the recording began.
   *
   * Entries with no `startedAt` (typed input) are skipped: they have no place in
   * the audio. Best-effort, like everything else here.
   */
  async saveTranscript(entries: TranslationEntry[]): Promise<void> {
    const session = this.lastSession();
    if (!session) return;

    const languages = this.settings.settings()?.languages ?? { source: 'en', target: 'fa' };
    const transcript: SessionTranscript = {
      startedAt: new Date(session.startedAt).toISOString(),
      durationMs: session.durationMs,
      languages: { source: languages.source, target: languages.target },
      entries: entries
        .filter((e) => e.startedAt !== undefined)
        .map((e) => ({
          // Anything spoken before recording began (or clock skew) clamps to 0
          // rather than seeking to a negative position.
          offsetMs: Math.max(0, e.startedAt! - session.startedAt),
          source: e.source,
          target: e.target,
          provider: e.provider,
          confidence: e.confidence,
        })),
    };

    try {
      await this.bridge.recordingSaveTranscript(JSON.stringify(transcript, null, 2));
    } catch (err: unknown) {
      this.error.set(`Could not save the session transcript: ${RecordingService.message(err)}`);
    }
  }

  /** Live mic-level change — applied to the running mix without a restart. */
  setMicGain(percent: number): void {
    if (this.micGain) this.micGain.gain.value = percent / 100;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async openMic(deviceId: string): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,  // the meeting audio is coming out of the speakers
          noiseSuppression: true,
        },
      });
    } catch {
      // Degrade to a system-only recording rather than losing the meeting.
      this.error.set('Microphone unavailable — recording system audio only.');
      return null;
    }
  }

  // Sum the captured stream and the mic into one recordable stream. This needs
  // its own AudioContext: AudioService pins its context to 16 kHz for the level
  // meter, and reusing it would resample the recording down to 16 kHz.
  private mix(captured: MediaStream, mic: MediaStream, micGainPercent: number): MediaStream {
    const ctx = new AudioContext();
    const destination = ctx.createMediaStreamDestination();

    ctx.createMediaStreamSource(captured).connect(destination);

    const gain = ctx.createGain();
    gain.gain.value = micGainPercent / 100;
    ctx.createMediaStreamSource(mic).connect(gain).connect(destination);

    this.context = ctx;
    this.micGain = gain;
    return destination.stream;
  }

  private addRecorder(track: RecordingTrack, stream: MediaStream, bitsPerSecond: number): void {
    const mimeType = RecordingService.pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: bitsPerSecond });
    } catch {
      recorder = new MediaRecorder(stream);
    }

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data.size === 0) return;
      const blob = ev.data;
      this.writeChain = this.writeChain.then(() => this.writeChunk(track, blob));
    };
    recorder.onerror = () => {
      this.error.set('Audio recorder error — the recording may be incomplete.');
    };

    recorder.start(CHUNK_MS);
    this.recorders.push({ track, recorder });
  }

  private async writeChunk(track: RecordingTrack, blob: Blob): Promise<void> {
    try {
      const buffer = await blob.arrayBuffer();
      await this.bridge.recordingChunk(track, new Uint8Array(buffer));
    } catch (err: unknown) {
      // Report once; later chunks keep trying in case the disk recovers.
      this.error.set(`Recording write failed: ${RecordingService.message(err)}`);
    }
  }

  // Stop a recorder and wait for its last blob. MediaRecorder emits a final
  // ondataavailable before onstop, so resolving on onstop guarantees we've seen it.
  private static finish(recorder: MediaRecorder): Promise<void> {
    if (recorder.state === 'inactive') return Promise.resolve();
    return new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }

  private async teardown(): Promise<void> {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.recorders = [];
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;

    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    this.micGain = null;

    this.isRecording.set(false);
    this.startedAt.set(null);
    this.elapsedMs.set(0);

    await this.bridge.recordingStop().catch(() => {});
  }

  private static pickMimeType(): string {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  }

  private static message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
