import {
  Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  RecordingSession,
  RecordingTrack,
  SessionNotes,
  SessionTranscriptEntry,
} from '../../core/models/app.models';
import { AssistService } from '../../core/services/assist.service';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { Language, languageByCode } from '../../core/models/languages';

// Typing shouldn't hit the disk on every keystroke, but a note must not be lost
// by navigating away either — hence a short debounce plus an explicit flush on
// blur, session switch and teardown.
const NOTE_SAVE_DEBOUNCE_MS = 700;

// Above roughly this much transcript, a local model with a small context window
// will quietly see only part of the meeting. We still send the whole thing —
// truncating either end loses real content silently — but we say so in the UI.
const LARGE_TRANSCRIPT_CHARS = 40000;

@Component({
  selector: 'app-review',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './review.html',
  styleUrl: './review.scss',
})
export class ReviewComponent implements OnInit, OnDestroy {
  private bridge = inject(ElectronBridgeService);
  private assist = inject(AssistService);

  protected sessions = signal<RecordingSession[]>([]);
  protected selected = signal<RecordingSession | null>(null);
  protected loading = signal(true);
  protected error = signal<string | null>(null);

  protected playing = signal(false);
  protected positionMs = signal(0);
  /** Which track is playing; only ever 'mic' for a 'separate'-mode session. */
  protected track = signal<RecordingTrack>('main');
  /** Index of the line currently being spoken, or -1 between lines. */
  protected activeIndex = signal(-1);

  // ── Notes ──────────────────────────────────────────────────────────────────
  protected sessionNote = signal('');
  /** Line notes for the selected session, keyed by the entry's offsetMs. */
  protected lineNotes = signal<Record<number, string>>({});
  /** Which line's note editor is open, by offsetMs; null = none. */
  protected editingNote = signal<number | null>(null);
  protected savingNote = signal(false);
  protected noteSaved = signal(false);

  // Duration priming state (see onLoadedMetadata) — per loaded audio source.
  private primed = false;
  private priming = false;
  private pendingSeekMs: number | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savedFlashTimer: ReturnType<typeof setTimeout> | null = null;
  // Serializes note writes so a stale snapshot can never land last.
  private saveChain: Promise<void> = Promise.resolve();

  @ViewChild('player') playerRef!: ElementRef<HTMLAudioElement>;

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  ngOnDestroy(): void {
    if (this.savedFlashTimer) clearTimeout(this.savedFlashTimer);
    // Leaving the view must not drop an in-flight edit.
    void this.flushNotes();
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const sessions = await this.bridge.recordingList();
      this.sessions.set(sessions);
      // Keep the current selection if it survived, else fall back to the newest.
      const current = this.selected();
      const stillThere = current && sessions.find((s) => s.file === current.file);
      this.select(stillThere ?? sessions[0] ?? null);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Could not list recordings');
    } finally {
      this.loading.set(false);
    }
  }

  protected select(session: RecordingSession | null): void {
    // Switching sessions must not carry a pending edit into the next one.
    void this.flushNotes();

    this.selected.set(session);
    this.playing.set(false);
    this.positionMs.set(0);
    this.activeIndex.set(-1);
    this.editingNote.set(null);
    this.track.set('main');
    this.resetPriming();

    const notes = session?.transcript?.notes;
    this.sessionNote.set(notes?.session ?? '');
    this.lineNotes.set(
      Object.fromEntries((notes?.lines ?? []).map((n) => [n.offsetMs, n.text]))
    );
  }

  /**
   * Source URL for the player — served by the rec:// handler in the main process.
   * In 'separate' mode the session has two tracks on one timeline, so switching
   * track keeps every transcript offset valid.
   */
  protected get audioSrc(): string {
    const session = this.selected();
    if (!session) return '';
    const file = this.track() === 'mic' && session.micFile ? session.micFile : session.file;
    return `rec://session/${encodeURIComponent(file)}`;
  }

  protected setTrack(track: RecordingTrack): void {
    if (this.track() === track) return;
    // Switching source resets the element; carry the position over so the
    // listener stays where they were in the meeting. The new source needs its
    // own duration prime, and seekTo holds the position until that finishes.
    const at = this.positionMs();
    this.track.set(track);
    this.resetPriming();
    setTimeout(() => this.seekTo(at), 0);
  }

  private resetPriming(): void {
    this.primed = false;
    this.priming = false;
    this.pendingSeekMs = null;
  }

  protected get entries(): SessionTranscriptEntry[] {
    return this.selected()?.transcript?.entries ?? [];
  }

  protected get durationMs(): number {
    return this.selected()?.transcript?.durationMs ?? 0;
  }

  protected get sourceLang(): Language {
    return languageByCode(this.selected()?.transcript?.languages.source);
  }

  protected get targetLang(): Language {
    return languageByCode(this.selected()?.transcript?.languages.target);
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  protected togglePlay(): void {
    const el = this.playerRef?.nativeElement;
    if (!el) return;
    if (el.paused) void el.play(); else el.pause();
  }

  /**
   * A WebM streamed to disk carries no duration, so the element reports
   * `Infinity` and its seek behaviour is undefined until it learns the real
   * length. Forcing one seek far past the end makes Chromium scan to the end and
   * settle on a real duration; after that, seeking is reliable. Runs once per
   * loaded source, and the UI ignores the excursion.
   */
  protected onLoadedMetadata(): void {
    const el = this.playerRef.nativeElement;
    if (this.primed || Number.isFinite(el.duration)) return;
    this.priming = true;
    el.currentTime = 1e101;
  }

  protected onDurationChange(): void {
    const el = this.playerRef.nativeElement;
    if (!this.priming || !Number.isFinite(el.duration)) return;

    this.priming = false;
    this.primed = true;
    el.currentTime = 0;
    this.positionMs.set(0);

    // A line clicked while priming was held back — honour it now.
    const pending = this.pendingSeekMs;
    if (pending !== null) {
      this.pendingSeekMs = null;
      this.seekTo(pending);
    }
  }

  protected onTimeUpdate(): void {
    // Priming sweeps to the end of the file; that is not a real position.
    if (this.priming) return;
    const el = this.playerRef.nativeElement;
    const ms = el.currentTime * 1000;
    this.positionMs.set(ms);

    // The line being spoken is the last one that has started.
    const entries = this.entries;
    let index = -1;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].offsetMs <= ms) index = i; else break;
    }
    this.activeIndex.set(index);
  }

  protected seekTo(ms: number): void {
    const el = this.playerRef?.nativeElement;
    if (!el) return;

    // Seeking mid-prime would be overwritten by the prime's own reset to 0.
    if (this.priming) {
      this.pendingSeekMs = ms;
      return;
    }

    el.currentTime = ms / 1000;
    this.positionMs.set(ms);
    if (el.paused) void el.play();
  }

  /** Click anywhere on the progress bar to scrub. */
  protected scrub(event: MouseEvent): void {
    const bar = event.currentTarget as HTMLElement;
    const ratio = (event.clientX - bar.getBoundingClientRect().left) / bar.offsetWidth;
    this.seekTo(Math.max(0, Math.min(1, ratio)) * this.durationMs);
  }

  protected get progressPercent(): string {
    const total = this.durationMs;
    return total > 0 ? `${Math.min(100, (this.positionMs() / total) * 100)}%` : '0%';
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  protected onSessionNoteChange(text: string): void {
    this.sessionNote.set(text);
    this.scheduleSave();
  }

  protected onLineNoteChange(offsetMs: number, text: string): void {
    this.lineNotes.update((notes) => ({ ...notes, [offsetMs]: text }));
    this.scheduleSave();
  }

  protected noteFor(offsetMs: number): string {
    return this.lineNotes()[offsetMs] ?? '';
  }

  protected hasNote(offsetMs: number): boolean {
    return this.noteFor(offsetMs).trim().length > 0;
  }

  /** Open (or close) the note editor for a line without seeking the player. */
  protected toggleNoteEditor(offsetMs: number, event: MouseEvent): void {
    event.stopPropagation();
    this.editingNote.update((open) => (open === offsetMs ? null : offsetMs));
    if (this.editingNote() === null) void this.flushNotes();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushNotes(), NOTE_SAVE_DEBOUNCE_MS);
  }

  /**
   * Write the current notes to the sidecar. Safe to call when nothing is pending.
   *
   * Saves are serialized: each one posts the whole notes object, so two in flight
   * at once can land out of order and an older snapshot wins — e.g. blurring the
   * session note and a line note in quick succession could write the line note
   * and then overwrite it with the earlier state that had no lines.
   */
  protected flushNotes(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveChain = this.saveChain.then(() => this.writeNotes());
    return this.saveChain;
  }

  private async writeNotes(): Promise<void> {
    const session = this.selected();
    if (!session?.transcript) return;

    const notes: SessionNotes = {
      session: this.sessionNote().trim() || undefined,
      // Empty text means the note was cleared — drop it rather than storing "".
      lines: Object.entries(this.lineNotes())
        .filter(([, text]) => text.trim().length > 0)
        .map(([offsetMs, text]) => ({ offsetMs: Number(offsetMs), text: text.trim() }))
        .sort((a, b) => a.offsetMs - b.offsetMs),
    };

    this.savingNote.set(true);
    try {
      const result = await this.bridge.recordingSaveNotes(session.file, notes);
      if (!result.saved) {
        this.error.set(result.error ?? 'Could not save notes.');
        return;
      }
      // Keep the in-memory session in step so re-selecting it shows the notes.
      session.transcript.notes = notes;
      this.flashSaved();
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Could not save notes.');
    } finally {
      this.savingNote.set(false);
    }
  }

  private flashSaved(): void {
    this.noteSaved.set(true);
    if (this.savedFlashTimer) clearTimeout(this.savedFlashTimer);
    this.savedFlashTimer = setTimeout(() => this.noteSaved.set(false), 1500);
  }

  // ── Ask the assistant ──────────────────────────────────────────────────────
  // Same shape of context the translator sends for selected rows: source lines
  // only. The source is what was actually said; the target is a translation of it.

  protected askSession(): void {
    const block = this.entries.map((e) => e.source).join('\n');
    if (!block) return;
    this.assist.openWith(block);
  }

  protected askLine(entry: SessionTranscriptEntry, event: MouseEvent): void {
    event.stopPropagation();
    this.assist.openWith(entry.source);
  }

  /** True when the transcript may outrun a small local model's context window. */
  protected get transcriptIsLarge(): boolean {
    return this.entries.reduce((n, e) => n + e.source.length, 0) > LARGE_TRANSCRIPT_CHARS;
  }

  // ── Session actions ────────────────────────────────────────────────────────

  protected async reveal(session: RecordingSession): Promise<void> {
    await this.bridge.recordingReveal(session.file);
  }

  protected async remove(session: RecordingSession): Promise<void> {
    // Goes to the OS trash, not a permanent delete — recoverable by design.
    const result = await this.bridge.recordingDelete(session.file);
    if (!result.deleted) {
      this.error.set(result.error ?? 'Could not delete that recording.');
      return;
    }
    if (this.selected()?.file === session.file) this.select(null);
    await this.refresh();
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  protected clock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const p = (n: number): string => String(n).padStart(2, '0');
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  protected sessionLabel(session: RecordingSession): string {
    const started = session.transcript?.startedAt ?? session.modifiedAt;
    return new Date(started).toLocaleString();
  }

  protected sessionMeta(session: RecordingSession): string {
    const mb = (session.sizeBytes / (1024 * 1024)).toFixed(1);
    const duration = session.transcript ? this.clock(session.transcript.durationMs) : null;
    const lines = session.transcript ? `${session.transcript.entries.length} lines` : 'no transcript';
    return [duration, lines, `${mb} MB`].filter(Boolean).join(' · ');
  }
}
