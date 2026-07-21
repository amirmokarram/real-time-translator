import {
  Component, inject, signal, effect, untracked,
  OnInit, OnDestroy, ViewChild, ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslationService } from '../../core/services/translation.service';
import { AudioService } from '../../core/services/audio.service';
import { PendingSentence, TranscriptionService } from '../../core/services/transcription.service';
import { SettingsService } from '../../core/services/settings.service';
import { ExportService, ExportFormat } from '../../core/services/export.service';
import { AssistService } from '../../core/services/assist.service';
import { RecordingService } from '../../core/services/recording.service';
import { TranslationEntry } from '../../core/models/app.models';
import { Language, languageByCode } from '../../core/models/languages';

@Component({
  selector: 'app-translator',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './translator.html',
  styleUrl: './translator.scss',
})
export class TranslatorComponent implements OnInit, OnDestroy {
  protected translation = inject(TranslationService);
  protected audio = inject(AudioService);
  protected transcription = inject(TranscriptionService);
  protected settings = inject(SettingsService);
  protected assist = inject(AssistService);
  protected recording = inject(RecordingService);
  private exportSvc = inject(ExportService);

  protected inputText = '';
  protected error = signal<string | null>(null);
  protected showExportMenu = signal(false);
  protected copiedId = signal<string | null>(null);

  // ── Row selection (powers multi-row copy; later feeds Ask-LLM) ──────────────
  // Set of selected entry ids. Click toggles a row; shift-click extends a range
  // from the last-clicked row, using the current history() order as the index.
  protected selectedIds = signal<Set<string>>(new Set());
  private lastClickedId: string | null = null;

  // FIFO of finalized STT sentences awaiting translation, drained one at a time
  // so a burst (e.g. several sentences from one utterance) is translated in
  // order without overlapping calls — never via the manual input box.
  private sttQueue: PendingSentence[] = [];
  private draining = false;
  private drainPromise: Promise<void> = Promise.resolve();
  // Previous value of audio.isCapturing(), so the effect below can spot the
  // true→false edge rather than firing on every read.
  private wasCapturing = false;
  // In-flight session finish, shared by the effect and ngOnDestroy.
  private finishPromise: Promise<void> | null = null;

  // Live partial translation (Phase B): debounce-translate the in-progress
  // English so the reader can follow along before the sentence finalizes.
  private partialTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPartialText = '';

  @ViewChild('historyContainer') historyContainer!: ElementRef<HTMLDivElement>;

  constructor() {
    // New finalized sentence(s) available → pull them all and queue for translation.
    effect(() => {
      this.transcription.finalVersion();
      untracked(() => {
        const sentences = this.transcription.takePending();
        if (sentences.length === 0) return;
        // The committed row supersedes the live preview for this sentence.
        this.translation.clearLivePartial();
        this.lastPartialText = '';
        this.sttQueue.push(...sentences);
        this.drainSttQueue();
      });
    });

    // Live preview: debounce-translate the un-committed English (opt-in).
    effect(() => {
      const interim = this.transcription.interimText();
      untracked(() => this.schedulePartial(interim));
    });

    // Capture stopped → the session is over, file its transcript. Watching the
    // flag rather than doing this in toggleCapture() covers the tray menu and the
    // global hotkey too: both stop capture through CommandService, and would
    // otherwise leave a recording with no sidecar next to it.
    effect(() => {
      const capturing = this.audio.isCapturing();
      untracked(() => {
        if (this.wasCapturing && !capturing) void this.finishSession();
        this.wasCapturing = capturing;
      });
    });

    // Scroll to bottom after DOM renders the new history row
    effect(() => {
      this.translation.history();
      untracked(() => {
        setTimeout(() => {
          const el = this.historyContainer?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 0);
      });
    });
  }

  async ngOnInit(): Promise<void> {
    await this.audio.loadSources();
  }

  ngOnDestroy(): void {
    if (this.partialTimer) clearTimeout(this.partialTimer);
    // Navigating away mid-capture stops it — but the effect below dies with this
    // component, so the session has to be finished explicitly here. The services
    // it touches are root-scoped, so the work completes fine after teardown.
    if (this.audio.isCapturing()) {
      void this.audio.stopCapture().then(() => this.finishSession());
    }
  }

  // Called by Translate button and Ctrl+Enter — reads the manual input box
  protected async doTranslate(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.translation.isTranslating()) return;
    this.inputText = '';
    await this.runTranslation(text);
  }

  // Core runner — shared by manual input and audio STT. `confidence` and
  // `startedAt` are only ever present for recognized speech: typed text has
  // nothing to be unsure of and no position in a recording.
  private async runTranslation(
    text: string,
    confidence?: number,
    startedAt?: number
  ): Promise<void> {
    this.error.set(null);
    try {
      await this.translation.translate(text, confidence, startedAt);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Translation failed');
    }
  }

  // Debounce a live-preview translation of the in-progress English. Skips when
  // the feature is off, not capturing, the text is trivial, or unchanged.
  private schedulePartial(interim: string): void {
    if (this.partialTimer) { clearTimeout(this.partialTimer); this.partialTimer = null; }

    const stt = this.settings.settings()?.stt;
    if (!stt?.livePartial || !this.audio.isCapturing()) return;

    const text = interim.trim();
    if (text.length < 2) {
      this.translation.livePersian.set('');
      this.lastPartialText = '';
      return;
    }
    if (text === this.lastPartialText) return;

    this.partialTimer = setTimeout(() => {
      this.lastPartialText = text;
      void this.translation.translatePartial(text);
    }, stt.partialDebounceMs ?? 600);
  }

  // Translate queued STT sentences sequentially → one history row each, in order.
  // Returns the in-flight drain when one is already running, so a caller can wait
  // for the queue to be empty regardless of who started it.
  private drainSttQueue(): Promise<void> {
    if (!this.draining) {
      this.draining = true;
      this.drainPromise = this.runDrain().finally(() => { this.draining = false; });
    }
    return this.drainPromise;
  }

  private async runDrain(): Promise<void> {
    while (this.sttQueue.length > 0) {
      const next = this.sttQueue.shift()!;
      await this.runTranslation(next.text, next.confidence, next.startedAt);
    }
  }

  // Recording length as m:ss (or h:mm:ss once a meeting runs past the hour).
  protected recElapsed(): string {
    const total = Math.floor(this.recording.elapsedMs() / 1000);
    const p = (n: number): string => String(n).padStart(2, '0');
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  // Compact session readout, e.g. "STT 96%" or "STT 91% · 3 low". Empty until the
  // backend has reported a confidence, so it stays invisible for typed-only use
  // and for backends that don't report one (Whisper).
  protected sttQualityLabel(): string {
    const avg = this.transcription.avgConfidence();
    if (avg === null) return '';
    const low = this.transcription.lowConfidenceCount();
    return `STT ${Math.round(avg * 100)}%${low > 0 ? ` · ${low} low` : ''}`;
  }

  // The recognizer wasn't confident about this row. Flagging it is a diagnostic:
  // the words it fumbled are exactly the ones worth adding to the custom
  // vocabulary list in Settings → Speech Recognition.
  protected isLowConfidence(entry: TranslationEntry): boolean {
    return entry.confidence !== undefined && entry.confidence < TranscriptionService.LOW_CONFIDENCE;
  }

  protected confidenceLabel(entry: TranslationEntry): string {
    if (entry.confidence === undefined) return '';
    return `Speech recognition confidence: ${Math.round(entry.confidence * 100)}%`;
  }

  // Copy a row's source text — handy mid-meeting when there's no time to retype.
  protected async copySource(entry: TranslationEntry): Promise<void> {
    try {
      await navigator.clipboard.writeText(entry.source);
      this.copiedId.set(entry.id);
      setTimeout(() => {
        if (this.copiedId() === entry.id) this.copiedId.set(null);
      }, 1500);
    } catch {
      this.error.set('Could not copy to clipboard');
    }
  }

  // ── Row selection ────────────────────────────────────────────────────────────

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected selectedCount(): number {
    return this.selectedIds().size;
  }

  // Click a row to toggle it; shift-click to select the contiguous range from
  // the previously clicked row (inclusive), in current history order.
  protected toggleRow(entry: TranslationEntry, event: MouseEvent): void {
    const next = new Set(this.selectedIds());

    if (event.shiftKey && this.lastClickedId) {
      const rows = this.translation.history();
      const from = rows.findIndex((e) => e.id === this.lastClickedId);
      const to = rows.findIndex((e) => e.id === entry.id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i++) next.add(rows[i].id);
        this.selectedIds.set(next);
        return;
      }
    }

    if (next.has(entry.id)) next.delete(entry.id);
    else next.add(entry.id);
    this.selectedIds.set(next);
    this.lastClickedId = entry.id;
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
    this.lastClickedId = null;
  }

  // Open assist mode with the selected rows (in history order) as context.
  protected askSelected(): void {
    const ids = this.selectedIds();
    if (ids.size === 0) return;
    // Source text only — the source of truth; the target is just a translation.
    const block = this.translation
      .history()
      .filter((e) => ids.has(e.id))
      .map((e) => e.source)
      .join('\n');

    this.assist.openWith(block);
    this.clearSelection();
  }

  protected onSourceChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    const source = this.audio.sources().find((s) => s.id === id);
    if (source) this.audio.selectSource(source);
  }

  protected toggleExportMenu(): void {
    this.showExportMenu.update((v) => !v);
  }

  protected async exportAs(format: ExportFormat): Promise<void> {
    this.showExportMenu.set(false);
    try {
      await this.exportSvc.export(this.translation.history(), format);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Export failed');
    }
  }

  protected async toggleCapture(): Promise<void> {
    if (this.audio.isCapturing()) {
      await this.audio.stopCapture();
      if (this.partialTimer) { clearTimeout(this.partialTimer); this.partialTimer = null; }
      this.lastPartialText = '';
      this.translation.clearLivePartial();
    } else {
      await this.audio.startCapture();
    }
  }

  // Stopping capture flushes the last buffered sentence, which still has to be
  // translated before the transcript is complete. Drain it here rather than
  // waiting on the effect (which runs on Angular's schedule, not ours), then file
  // the sidecar next to the audio. No-op when nothing was recorded.
  //
  // Re-entrant on purpose: a stop can reach this from both the isCapturing effect
  // and ngOnDestroy, and they must not race into two half-drained writes.
  private finishSession(): Promise<void> {
    if (!this.finishPromise) {
      this.finishPromise = this.runFinishSession().finally(() => {
        this.finishPromise = null;
      });
    }
    return this.finishPromise;
  }

  private async runFinishSession(): Promise<void> {
    const tail = this.transcription.takePending();
    if (tail.length > 0) this.sttQueue.push(...tail);
    await this.drainSttQueue();
    await this.recording.saveTranscript(this.translation.history());
  }

  // Live panel: show interim while speaking, last final between sentences
  protected get liveEnglish(): string {
    return this.transcription.interimText() || this.transcription.lastFinalText() || '';
  }

  protected get livePartialEnabled(): boolean {
    return this.settings.settings()?.stt.livePartial ?? false;
  }

  protected get audioBarWidth(): string {
    return `${Math.round(this.audio.audioLevel() * 100)}%`;
  }

  protected get providerName(): string {
    const id = this.settings.activeProvider();
    return this.settings.providerMeta(id)?.name ?? id;
  }

  // Configured source/target languages — drive the column headers and per-cell
  // text direction + font.
  protected get sourceLang(): Language {
    return languageByCode(this.settings.settings()?.languages.source);
  }

  protected get targetLang(): Language {
    return languageByCode(this.settings.settings()?.languages.target);
  }

  protected trackEntry(_: number, e: TranslationEntry): string {
    return e.id;
  }

  protected formatTime(d: Date): string {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
