import { Injectable, inject, signal } from '@angular/core';
import { AssistMessage, BankMatch } from '../models/app.models';
import { ElectronBridgeService } from './electron-bridge.service';

// The user turn for the Question Bank no-match branch. The system prompt for this
// branch is NOT defined here: it's resolved in the MAIN process from
// settings.prompts.interviewAnswer (editable in Settings, empty → the built-in
// default in electron/prompts.ts) — the renderer only names the prompt kind.
const INTERVIEW_ANSWER_INSTRUCTION =
  'Answer the interviewer’s question shown in the transcript, ready for me to say out loud.';

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
  // Files surfaced by the last "Query From Q Bank" run, shown as clickable cards.
  readonly bankMatches = signal<BankMatch[]>([]);
  readonly bankSearching = signal(false);

  // Id of the ask() we're currently listening to. stop() clears it — chunks and
  // the completion of a stopped generation no longer match and are dropped
  // (main keeps generating in the background; we just detach).
  private activeRequestId: string | null = null;

  // Open the panel seeded with a transcript block (from selected rows). Opening
  // with new context starts a fresh thread.
  openWith(context: string): void {
    this.context.set(context);
    this.messages.set([]);
    this.streaming.set('');
    this.error.set(null);
    this.bankMatches.set([]);
    this.isOpen.set(true);
  }

  // Open for a free-form question with no transcript context (header entry point).
  open(): void {
    this.context.set(null);
    this.messages.set([]);
    this.streaming.set('');
    this.error.set(null);
    this.bankMatches.set([]);
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
    this.bankMatches.set([]);
  }

  // Ask the LLM router which prepared answer fits the selected interviewer question.
  //  • Match found → show the file card(s); Amir opens and reads his own answer.
  //  • No match    → generate a fresh interview-ready answer via the distilled prompt.
  async queryFromBank(): Promise<void> {
    if (this.isAsking() || this.bankSearching()) return;
    const query = (this.context() ?? this.lastUserQuestion() ?? '').trim();
    if (!query) {
      this.error.set('Select some transcript rows first, then Query From Q Bank.');
      return;
    }

    this.error.set(null);
    this.bankMatches.set([]);
    this.bankSearching.set(true);
    let matches: BankMatch[];
    try {
      matches = await this.bridge.bankRoute(query);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Question bank lookup failed');
      return;
    } finally {
      this.bankSearching.set(false);
    }

    if (matches.length > 0) {
      // A prepared answer exists — surface it and stop. Amir opens the file himself.
      this.bankMatches.set(matches);
      const label = matches.length === 1 ? 'a prepared answer' : `${matches.length} prepared answers`;
      this.messages.update((m) => [
        ...m,
        { role: 'assistant', content: `Found ${label} for this question — open below to read.` },
      ]);
      return;
    }

    // Nothing prepared → generate an interview-ready answer in Amir's voice.
    await this.ask(INTERVIEW_ANSWER_INSTRUCTION, undefined, 'interviewAnswer');
  }

  private lastUserQuestion(): string | null {
    const users = this.messages().filter((m) => m.role === 'user');
    return users.length ? users[users.length - 1].content : null;
  }

  async ask(
    question: string,
    contextOverride?: string,
    promptKind?: 'assist' | 'interviewAnswer'
  ): Promise<void> {
    const q = question.trim();
    if (!q || this.isAsking()) return;

    this.error.set(null);
    this.isAsking.set(true);
    this.streaming.set('');
    this.messages.update((m) => [...m, { role: 'user', content: q }]);

    const requestId = crypto.randomUUID();
    this.activeRequestId = requestId;

    // Only append chunks from THIS request while it's still the active one —
    // a stopped generation keeps streaming from main until it finishes.
    const unsub = this.bridge.onAssistChunk((event) => {
      if (event.requestId === requestId && this.activeRequestId === requestId) {
        this.streaming.update((s) => s + event.text);
      }
    });

    try {
      const full = await this.bridge.assist({
        messages: this.messages(),
        context: contextOverride ?? this.context() ?? undefined,
        promptKind,
        requestId,
      });
      if (this.activeRequestId !== requestId) return; // stopped — partial already committed
      this.messages.update((m) => [...m, { role: 'assistant', content: full }]);
    } catch (err: unknown) {
      if (this.activeRequestId !== requestId) return;
      this.error.set(err instanceof Error ? err.message : 'Assist request failed');
    } finally {
      unsub();
      if (this.activeRequestId === requestId) {
        this.activeRequestId = null;
        this.streaming.set('');
        this.isAsking.set(false);
      }
    }
  }

  // Stop generating: detach from the in-flight request and keep whatever has
  // streamed so far as the answer. The provider call finishes in the background
  // (its chunks/completion no longer match activeRequestId and are dropped).
  stop(): void {
    if (!this.isAsking()) return;
    const partial = this.streaming().trimEnd();
    this.activeRequestId = null;
    if (partial) {
      this.messages.update((m) => [...m, { role: 'assistant', content: partial }]);
    }
    this.streaming.set('');
    this.isAsking.set(false);
  }
}
