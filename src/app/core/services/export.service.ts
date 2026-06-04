import { Injectable, inject } from '@angular/core';
import { TranslationEntry } from '../models/app.models';
import { ElectronBridgeService } from './electron-bridge.service';

export type ExportFormat = 'txt' | 'srt';

@Injectable({ providedIn: 'root' })
export class ExportService {
  private bridge = inject(ElectronBridgeService);

  async export(entries: TranslationEntry[], format: ExportFormat): Promise<{ saved: boolean; path?: string }> {
    if (entries.length === 0) return { saved: false };

    const content = format === 'srt' ? this.toSrt(entries) : this.toTxt(entries);
    const defaultName = `translation-${this.fileStamp()}.${format}`;
    return this.bridge.exportFile(content, defaultName);
  }

  // ── TXT transcript ────────────────────────────────────────────────────────────

  private toTxt(entries: TranslationEntry[]): string {
    const lines: string[] = [
      'Real-Time Translation Transcript',
      `Exported: ${new Date().toLocaleString()}`,
      `Segments: ${entries.length}`,
      '='.repeat(50),
      '',
    ];

    for (const e of entries) {
      lines.push(`[${this.asDate(e.timestamp).toLocaleTimeString()}]  (${e.provider})`);
      lines.push(`EN: ${e.english}`);
      lines.push(`FA: ${e.persian}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── SRT subtitles ──────────────────────────────────────────────────────────────

  private toSrt(entries: TranslationEntry[]): string {
    const start0 = this.asDate(entries[0].timestamp).getTime();
    const blocks: string[] = [];

    entries.forEach((e, i) => {
      const startMs = this.asDate(e.timestamp).getTime() - start0;
      const rawNext =
        i < entries.length - 1
          ? this.asDate(entries[i + 1].timestamp).getTime() - start0
          : startMs + 4000;
      const endMs = Math.max(rawNext, startMs + 1500); // ensure visible duration

      blocks.push(String(i + 1));
      blocks.push(`${this.srtTime(startMs)} --> ${this.srtTime(endMs)}`);
      blocks.push(e.english);
      blocks.push(e.persian);
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
