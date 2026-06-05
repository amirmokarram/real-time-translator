import {
  Component, inject, signal, effect, untracked,
  OnInit, OnDestroy, ViewChild, ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslationService } from '../../core/services/translation.service';
import { AudioService } from '../../core/services/audio.service';
import { TranscriptionService } from '../../core/services/transcription.service';
import { SettingsService } from '../../core/services/settings.service';
import { ExportService, ExportFormat } from '../../core/services/export.service';
import { TranslationEntry } from '../../core/models/app.models';

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
  private exportSvc = inject(ExportService);

  protected inputText = '';
  protected error = signal<string | null>(null);
  protected showExportMenu = signal(false);
  protected copiedId = signal<string | null>(null);

  private lastTranslatedText = '';

  @ViewChild('historyContainer') historyContainer!: ElementRef<HTMLDivElement>;

  constructor() {
    // Finalized STT segment → translate directly, never touch the manual input box
    effect(() => {
      const final = this.transcription.lastFinalText();
      if (!final || final === this.lastTranslatedText) return;
      untracked(() => {
        this.lastTranslatedText = final;
        this.runTranslation(final);
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
    if (this.audio.isCapturing()) this.audio.stopCapture();
  }

  // Called by Translate button and Ctrl+Enter — reads the manual input box
  protected async doTranslate(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.translation.isTranslating()) return;
    this.inputText = '';
    await this.runTranslation(text);
  }

  // Core runner — shared by manual input and audio STT
  private async runTranslation(text: string): Promise<void> {
    this.error.set(null);
    try {
      await this.translation.translate(text);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Translation failed');
    }
  }

  // Copy a row's English source text — handy mid-meeting when there's no time to retype.
  protected async copyEnglish(entry: TranslationEntry): Promise<void> {
    try {
      await navigator.clipboard.writeText(entry.english);
      this.copiedId.set(entry.id);
      setTimeout(() => {
        if (this.copiedId() === entry.id) this.copiedId.set(null);
      }, 1500);
    } catch {
      this.error.set('Could not copy to clipboard');
    }
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
    } else {
      await this.audio.startCapture();
    }
  }

  // Live panel: show interim while speaking, last final between sentences
  protected get liveEnglish(): string {
    return this.transcription.interimText() || this.transcription.lastFinalText() || '';
  }

  protected get audioBarWidth(): string {
    return `${Math.round(this.audio.audioLevel() * 100)}%`;
  }

  protected get providerName(): string {
    const id = this.settings.activeProvider();
    return this.settings.providerMeta(id)?.name ?? id;
  }

  protected trackEntry(_: number, e: TranslationEntry): string {
    return e.id;
  }

  protected formatTime(d: Date): string {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
