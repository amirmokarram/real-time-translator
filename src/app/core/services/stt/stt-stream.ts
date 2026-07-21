// Strategy abstraction over a streaming speech-to-text backend. DeepGram (cloud)
// and Whisper (local) speak different protocols but both reduce to the same set
// of semantic events, which TranscriptionService turns into committed sentences.

export interface SttStartOptions {
  language: string;   // BCP-47-ish, e.g. 'en-US'; each backend narrows as needed
  apiKey?: string;    // DeepGram
  endpoint?: string;  // Whisper — WhisperLive WebSocket URL
  model?: string;     // model name: Whisper size/name, or DeepGram model ('nova-3'/'nova-2')
  useVad?: boolean;   // Whisper — server-side voice-activity gating
  keyterms?: string[]; // custom vocabulary to bias recognition (names, jargon, acronyms)
  audioBitrateKbps?: number; // DeepGram — Opus upload bitrate; higher = more detail for the recognizer
  endpointingMs?: number;  // DeepGram — silence (ms) before a fragment is finalized
  utteranceEndMs?: number; // DeepGram — end-of-utterance backstop (ms); API floor is 1000
}

export interface SttCallbacks {
  /**
   * A chunk of finalized text. `endOfUtterance` = the speaker paused (close the
   * utterance). `confidence` (0–1) is the backend's own certainty, when it reports
   * one — used to flag shaky recognition, not to gate anything.
   *
   * `speechStartAt` is the epoch-ms moment these words were actually SPOKEN, when
   * the backend reports audio timings (Deepgram does; Whisper doesn't). Without
   * it the consumer falls back to arrival time, which trails the speech by the
   * recognizer's latency — fine for ordering, too late for seeking a recording.
   */
  final(
    text: string,
    endOfUtterance: boolean,
    confidence?: number,
    speechStartAt?: number
  ): void;
  /** Current in-flight (not yet final) words, for the live panel. */
  interim(text: string): void;
  /** Utterance ended with no accompanying text (silence backstop). */
  utteranceEnd(): void;
  /** Recoverable problem — status message only; the strategy handles its own reconnect. */
  error(message: string): void;
  /** Unrecoverable — the session must stop (e.g. rejected credentials). */
  fatal(message: string): void;
}

export interface ISttStream {
  /** Begin streaming `stream` to the STT backend. Resolves once connected. */
  start(stream: MediaStream, opts: SttStartOptions, cb: SttCallbacks): Promise<void>;
  /** Stop streaming and release all resources. Idempotent. */
  stop(): void;
}
