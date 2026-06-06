import {
  Component, inject, signal, effect, untracked,
  ViewChild, ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssistService } from '../../core/services/assist.service';

@Component({
  selector: 'app-assist-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './assist-panel.html',
  styleUrl: './assist-panel.scss',
})
export class AssistPanelComponent {
  protected assist = inject(AssistService);

  protected question = '';
  protected showContext = signal(false);

  @ViewChild('thread') thread!: ElementRef<HTMLDivElement>;

  // Quick-action prompts that prefill + send against the selected context.
  protected readonly quickActions = [
    { label: 'Summarize', prompt: 'Summarize this part of the conversation.' },
    { label: 'Explain', prompt: 'Explain what this means in simple terms.' },
    { label: 'Key terms', prompt: 'List and briefly define the key terms used here.' },
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

  protected close(): void {
    this.assist.close();
  }
}
