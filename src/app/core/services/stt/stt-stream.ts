// Strategy abstraction over a streaming speech-to-text backend. DeepGram (cloud)
// and Whisper (local) speak different protocols but both reduce to the same set
// of semantic events, which TranscriptionService turns into committed sentences.

export interface SttStartOptions {
  language: string;   // BCP-47-ish, e.g. 'en-US'; each backend narrows as needed
  apiKey?: string;    // DeepGram
  endpoint?: string;  // Whisper — WhisperLive WebSocket URL
  model?: string;     // Whisper — model name/size the server should load
  useVad?: boolean;   // Whisper — server-side voice-activity gating
}

export interface SttCallbacks {
  /** A chunk of finalized text. `endOfUtterance` = the speaker paused (close the utterance). */
  final(text: string, endOfUtterance: boolean): void;
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
