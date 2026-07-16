import {
  Component, inject, signal, effect, untracked, computed,
  ViewChild, ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssistService } from '../../core/services/assist.service';
import { SettingsService } from '../../core/services/settings.service';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { MarkdownPipe } from '../../shared/markdown.pipe';

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

  constructor() {
    // Scroll the thread to the bottom as messages/stream grow.
    effect(() => {
      this.assist.messages();
      this.assist.streaming();
      untracked(() => {
        setTimeout(() => {
          const el = this.thread?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 0);
      });
    });
  }

  protected async send(): Promise<void> {
    const q = this.question.trim();
    if (!q || this.assist.isAsking()) return;
    this.question = '';
    await this.assist.ask(q);
  }

  protected async runQuick(prompt: string): Promise<void> {
    if (this.assist.isAsking()) return;
    await this.assist.ask(prompt);
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
