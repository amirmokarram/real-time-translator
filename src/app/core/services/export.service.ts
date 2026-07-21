import { Injectable, inject } from '@angular/core';
import { TranslationEntry } from '../models/app.models';
import { languageByCode } from '../models/languages';
import { ElectronBridgeService } from './electron-bridge.service';
import { RecordingService } from './recording.service';
import { SettingsService } from './settings.service';

export type ExportFormat = 'txt' | 'srt';

@Injectable({ providedIn: 'root' })
export class ExportService {
  private bridge = inject(ElectronBridgeService);
  private settings = inject(SettingsService);
  private recording = inject(RecordingService);

  async export(entries: TranslationEntry[], format: ExportFormat): Promise<{ saved: boolean; path?: string }> {
    if (entries.length === 0) return { saved: false };

    const content = format === 'srt' ? this.toSrt(entries) : this.toTxt(entries);
    const defaultName = `translation-${this.fileStamp()}.${format}`;
    return this.bridge.exportFile(content, defaultName);
  }

  // ── TXT transcript ────────────────────────────────────────────────────────────

  private toTxt(entries: TranslationEntry[]): string {
    const langs = this.settings.settings()?.languages;
    const srcLabel = languageByCode(langs?.source).name;
    const tgtLabel = languageByCode(langs?.target).name;

    const lines: string[] = [
      'Real-Time Translation Transcript',
      `Exported: ${new Date().toLocaleString()}`,
      `Segments: ${entries.length}`,
      '='.repeat(50),
      '',
    ];

    for (const e of entries) {
      lines.push(`[${this.asDate(e.timestamp).toLocaleTimeString()}]  (${e.provider})`);
      lines.push(`${srcLabel}: ${e.source}`);
      lines.push(`${tgtLabel}: ${e.target}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── SRT subtitles ──────────────────────────────────────────────────────────────

  private toSrt(entries: TranslationEntry[]): string {
    // Zero on the recording when there is one, so the subtitles drop straight onto
    // the audio file in a player. Without a recording there is nothing to sync to,
    // so the first line becomes 00:00 as before.
    const session = this.recording.lastSession();
    const start0 = session
      ? session.startedAt
      : this.asDate(entries[0].timestamp).getTime();
    const blocks: string[] = [];

    // Speech-start time is what lines up with audio; timestamp (translation
    // completed) trails it by a second or more. Typed rows only have the latter.
    const cueTime = (e: TranslationEntry): number =>
      e.startedAt ?? this.asDate(e.timestamp).getTime();

    entries.forEach((e, i) => {
      const startMs = Math.max(0, cueTime(e) - start0);
      const rawNext =
        i < entries.length - 1
          ? Math.max(0, cueTime(entries[i + 1]) - start0)
          : startMs + 4000;
      const endMs = Math.max(rawNext, startMs + 1500); // ensure visible duration

      blocks.push(String(i + 1));
      blocks.push(`${this.srtTime(startMs)} --> ${this.srtTime(endMs)}`);
      blocks.push(e.source);
      blocks.push(e.target);
      blocks.push('');
    });

    return blocks.join('\n');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────

  private srtTime(ms: number): string {
    const t = Math.max(0, Math.floor(ms));
    const h = Math.floor(t / 3_600_000);
    const m = Math.floor((t % 3_600_000) / 60_000);
    const s = Math.floor((t % 60_000) / 1000);
    const millis = t % 1000;
    const p = (n: number, len = 2) => String(n).padStart(len, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(millis, 3)}`;
  }

  private fileStamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // timestamp may arrive as a Date or a serialized string depending on source
  private asDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }
}
