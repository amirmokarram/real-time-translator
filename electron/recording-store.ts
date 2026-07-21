import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

// Which input a chunk belongs to. 'main' is the captured source (system audio or
// a microphone); 'mic' only exists in 'separate' mode, where the microphone is
// written to its own file instead of being mixed into the main one.
export type RecordingTrack = 'main' | 'mic';

export interface RecordingStartResult {
  paths: Partial<Record<RecordingTrack, string>>;
}

export interface RecordingStopResult {
  files: { track: RecordingTrack; path: string; bytes: number }[];
}

/** One past session: an audio file, plus its transcript sidecar when it has one. */
export interface RecordingSession {
  file: string;        // basename — also the id the rec:// protocol serves
  path: string;        // absolute, for reveal/delete
  sizeBytes: number;
  modifiedAt: string;
  transcript: unknown | null; // parsed sidecar (SessionTranscript) when present
}

/**
 * Absolute path of the recordings folder. '' in settings → <userData>/recordings.
 * Exported because both the store and the rec:// protocol handler resolve it.
 */
export function recordingsDir(folderPath: string): string {
  return folderPath.trim() || path.join(app.getPath('userData'), 'recordings');
}

/**
 * Resolve a session file *by basename only*, refusing anything that escapes the
 * recordings folder. The renderer supplies these names, so treat them as input:
 * `path.basename` strips traversal, and the realpath check is the backstop.
 */
export function resolveSessionFile(folderPath: string, file: string): string | null {
  const dir = recordingsDir(folderPath);
  const resolved = path.resolve(dir, path.basename(file));
  return resolved.startsWith(path.resolve(dir) + path.sep) ? resolved : null;
}

/**
 * Merge notes into a session's existing sidecar.
 *
 * Main does the merge rather than taking a whole transcript from the renderer:
 * the renderer would be posting back a copy it read earlier, and a stale one
 * would silently overwrite the transcript. Here only the `notes` key is touched.
 *
 * The write goes via a temp file + rename so an interrupted save can't leave a
 * half-written sidecar behind — losing notes is bad, losing the transcript with
 * them is worse.
 */
export async function saveNotes(
  folderPath: string,
  file: string,
  notes: unknown
): Promise<{ saved: boolean; error?: string }> {
  const audio = resolveSessionFile(folderPath, file);
  if (!audio) return { saved: false, error: 'Unknown recording.' };

  const sidecar = audio.replace(/\.webm$/, '') + '.json';
  try {
    const existing = JSON.parse(await fsp.readFile(sidecar, 'utf-8')) as Record<string, unknown>;
    const merged = JSON.stringify({ ...existing, notes }, null, 2);

    const tmp = `${sidecar}.tmp`;
    await fsp.writeFile(tmp, merged, 'utf-8');
    await fsp.rename(tmp, sidecar);
    return { saved: true };
  } catch (err: unknown) {
    return { saved: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** List past sessions, newest first, pairing each audio file with its sidecar. */
export async function listSessions(folderPath: string): Promise<RecordingSession[]> {
  const dir = recordingsDir(folderPath);
  const names = await fsp.readdir(dir).catch(() => [] as string[]);

  const sessions: RecordingSession[] = [];
  for (const name of names.filter((n) => n.endsWith('.webm'))) {
    const full = path.join(dir, name);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;

    // A sidecar is optional: a session interrupted by a crash keeps its audio.
    const sidecar = full.replace(/\.webm$/, '') + '.json';
    let transcript: unknown | null = null;
    try {
      transcript = JSON.parse(await fsp.readFile(sidecar, 'utf-8'));
    } catch {
      transcript = null;
    }

    sessions.push({
      file: name,
      path: full,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      transcript,
    });
  }

  return sessions.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

// Writes session audio to disk as it arrives.
//
// The renderer hands us MediaRecorder chunks every few seconds and we append them
// straight to a write stream, rather than buffering a whole meeting in renderer
// memory and writing once at the end: a two-hour session is tens of megabytes, and
// a crash would otherwise take the entire recording with it instead of the last
// few seconds.
//
// Concatenated MediaRecorder chunks form a valid WebM stream. A file left behind
// by a crash is missing its duration/cues, so players can't seek it well, but the
// audio itself is intact and playable.
export class RecordingStore {
  private streams = new Map<RecordingTrack, fs.WriteStream>();
  private paths = new Map<RecordingTrack, string>();
  private bytes = new Map<RecordingTrack, number>();

  // Path of the last main track written, kept after stop() so the transcript
  // sidecar can be filed next to its audio. The transcript can only be finalized
  // once the closing sentence has been translated, which happens after the audio
  // file is already closed.
  private lastMainPath: string | null = null;

  isRecording(): boolean {
    return this.streams.size > 0;
  }

  /**
   * Open a file per requested track. `folderPath` empty → <userData>/recordings.
   * Throws if a session is already open (the renderer is expected to stop first).
   */
  async start(folderPath: string, tracks: RecordingTrack[]): Promise<RecordingStartResult> {
    if (this.isRecording()) {
      throw new Error('A recording is already in progress.');
    }

    const dir = folderPath.trim() || path.join(app.getPath('userData'), 'recordings');
    await fsp.mkdir(dir, { recursive: true });

    const stamp = RecordingStore.fileStamp();
    const result: RecordingStartResult = { paths: {} };

    for (const track of tracks) {
      // In 'separate' mode both files are suffixed so the pair is obvious in the
      // folder; a single-file session keeps the plain name.
      const suffix = tracks.length > 1 ? (track === 'mic' ? '-mic' : '-system') : '';
      const filePath = path.join(dir, `meeting-${stamp}${suffix}.webm`);

      this.streams.set(track, fs.createWriteStream(filePath));
      this.paths.set(track, filePath);
      this.bytes.set(track, 0);
      result.paths[track] = filePath;
      if (track === 'main') this.lastMainPath = filePath;
    }

    return result;
  }

  /**
   * Write the transcript sidecar beside the audio it belongs to, as
   * `<audio-name>.json`. No-op when no session has been recorded yet.
   */
  async saveTranscript(content: string): Promise<{ path: string | null }> {
    if (!this.lastMainPath) return { path: null };

    const sidecar = this.lastMainPath.replace(/\.webm$/, '') + '.json';
    await fsp.writeFile(sidecar, content, 'utf-8');
    return { path: sidecar };
  }

  /** Append one MediaRecorder chunk. Silently ignores chunks for a closed track. */
  async write(track: RecordingTrack, chunk: Uint8Array): Promise<void> {
    const stream = this.streams.get(track);
    if (!stream) return;

    await new Promise<void>((resolve, reject) => {
      stream.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
    this.bytes.set(track, (this.bytes.get(track) ?? 0) + chunk.byteLength);
  }

  /** Close every open file and report what was written. Safe to call when idle. */
  async stop(): Promise<RecordingStopResult> {
    const files: RecordingStopResult['files'] = [];

    for (const [track, stream] of this.streams) {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
      files.push({
        track,
        path: this.paths.get(track)!,
        bytes: this.bytes.get(track) ?? 0,
      });
    }

    this.streams.clear();
    this.paths.clear();
    this.bytes.clear();
    return { files };
  }

  // Same shape as the export filename stamp: 2026-07-21-1432.
  private static fileStamp(): string {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
}
