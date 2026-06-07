import { Injectable, inject, signal } from '@angular/core';
import { AssistMessage } from '../models/app.models';
import { ElectronBridgeService } from './electron-bridge.service';

// Drives the assist (LLM Q&A) slide-in panel. Holds one chat thread plus the
// optional transcript context the user selected when they opened it.
@Injectable({ providedIn: 'root' })
export class AssistService {
  private bridge = inject(ElectronBridgeService);

  readonly isOpen = signal(false);
  readonly context = signal<string | null>(null);
  readonly messages = signal<AssistMessage[]>([]);
  readonly streaming = signal('');     // assistant reply being streamed
  readonly isAsking = signal(false);
  readonly error = signal<string | null>(null);

  // Open the panel seeded with a transcript block (from selected rows). Opening
  // with new context starts a fresh thread.
  openWith(context: string): void {
    this.context.set(context);
    this.messages.set([]);
    this.streaming.set('');
    this.error.set(null);
    this.isOpen.set(true);
  }

  // Open for a free-form question with no transcript context (header entry point).
  open(): void {
    this.context.set(null);
    this.messages.set([]);
    this.streaming.set('');
    this.error.set(null);
    this.isOpen.set(true);
  }

  toggle(): void {
    this.isOpen() ? this.close() : this.open();
  }

  close(): void {
    this.isOpen.set(false);
  }

  reset(): void {
    this.messages.set([]);
    this.streaming.set('');
    this.error.set(null);
  }

  async ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q || this.isAsking()) return;

    this.error.set(null);
    this.isAsking.set(true);
    this.streaming.set('');
    this.messages.update((m) => [...m, { role: 'user', content: q }]);

    const unsub = this.bridge.onAssistChunk((chunk) =>
      this.streaming.update((s) => s + chunk)
    );

    try {
      const full = await this.bridge.assist({
        messages: this.messages(),
        context: this.context() ?? undefined,
      });
      this.messages.update((m) => [...m, { role: 'assistant', content: full }]);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Assist request failed');
    } finally {
      unsub();
      this.streaming.set('');
      this.isAsking.set(false);
    }
  }
}
