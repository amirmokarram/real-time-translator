import {
  Component, inject, signal, effect, untracked, computed,
  ViewChild, ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssistService } from '../../core/services/assist.service';
import { SettingsService } from '../../core/services/settings.service';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { MarkdownPipe } from '../../shared/markdown.pipe';

// How close to the bottom still counts as "at the bottom". Covers fractional
// scroll positions from zoom/DPI, which never resolve to an exact 0.
const BOTTOM_THRESHOLD_PX = 32;

@Component({
  selector: 'app-assist-panel',
  standalone: true,
  imports: [FormsModule, MarkdownPipe],
  templateUrl: './assist-panel.html',
  styleUrl: './assist-panel.scss',
})
export class AssistPanelComponent {
  protected assist = inject(AssistService);
  private settingsSvc = inject(SettingsService);
  private bridge = inject(ElectronBridgeService);

  protected question = '';
  protected showContext = signal(false);
  // Index of the assistant message whose Copy button just fired (for the ✓ flash).
  protected copiedIdx = signal<number | null>(null);

  // "Query From Q Bank" only makes sense once a bank folder is configured.
  protected bankConfigured = computed(() =>
    !!this.settingsSvc.settings()?.questionBank?.folderPath?.trim()
  );

  @ViewChild('thread') thread!: ElementRef<HTMLDivElement>;

  // Quick-action prompts (sent as user messages under the single assist system
  // prompt) tuned for the interview flow against the selected context.
  protected readonly quickActions = [
    { label: 'Explain', prompt: "Explain what the interviewer is asking and define the key terms. Don't answer yet." },
    { label: 'Answer', prompt: 'Give me a natural, first-person answer I can say out loud.' },
    { label: 'Key terms', prompt: 'Define the technical terms here simply.' },
  ];

  // True while the live end of the thread is in view. Drives the "jump to
  // latest" pill only — it never causes a scroll.
  protected atLiveEnd = signal(true);

  constructor() {
    // The thread NEVER scrolls itself as an answer streams in: an answer you
    // are part-way through reading must stay exactly where it is. The only
    // scroll we perform is positioning a newly asked question (see below).
    // This just keeps the "jump to latest" pill honest as content grows —
    // appending doesn't move scrollTop, so no scroll event fires for it.
    effect(() => {
      this.assist.messages();
      this.assist.streaming();
      untracked(() => setTimeout(() => this.syncLiveEnd(), 0));
    });
  }

  protected onThreadScroll(): void {
    this.syncLiveEnd();
  }

  private syncLiveEnd(): void {
    const el = this.thread?.nativeElement;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.atLiveEnd.set(fromBottom <= BOTTOM_THRESHOLD_PX);
  }

  /** One-shot catch-up to the newest text. Does not start following. */
  protected jumpToLatest(): void {
    const el = this.thread?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    this.syncLiveEnd();
  }

  /**
   * Put the just-asked question at the top of the panel, so the answer streams
   * into the empty space below it and can be read from its first word without
   * anything moving. The one scroll the panel performs on its own.
   */
  private showQuestionFromTop(): void {
    setTimeout(() => {
      const el = this.thread?.nativeElement;
      if (!el) return;
      const asked = el.querySelectorAll<HTMLElement>('.msg-user');
      const last = asked[asked.length - 1];
      if (!last) return;
      const offset =
        last.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      el.scrollTop = Math.max(0, offset - 8);
      this.syncLiveEnd();
    }, 0);
  }

  protected async send(): Promise<void> {
    const q = this.question.trim();
    if (!q || this.assist.isAsking()) return;
    this.question = '';
    const asking = this.assist.ask(q);
    this.showQuestionFromTop();
    await asking;
  }

  protected async runQuick(prompt: string): Promise<void> {
    if (this.assist.isAsking()) return;
    const asking = this.assist.ask(prompt);
    this.showQuestionFromTop();
    await asking;
  }

  protected async queryFromBank(): Promise<void> {
    await this.assist.queryFromBank();
  }

  protected async openBankFile(path: string): Promise<void> {
    const result = await this.bridge.bankOpen(path);
    if (!result.opened && result.error) this.assist.error.set(result.error);
  }

  protected close(): void {
    this.assist.close();
  }

  // Copy an answer's raw markdown — ready to paste mid-meeting.
  protected async copyAnswer(content: string, idx: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      this.copiedIdx.set(idx);
      setTimeout(() => {
        if (this.copiedIdx() === idx) this.copiedIdx.set(null);
      }, 1500);
    } catch {
      this.assist.error.set('Could not copy to clipboard');
    }
  }
}
