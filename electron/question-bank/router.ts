// The accuracy-first selection path: instead of scoring filenames in code, we ask
// the configured LLM which prepared answer (if any) fits the interviewer's
// question. This is a plain text-in/text-out classification — no tool-calling — so
// it works on every assist provider, local ones included.

import { BankEntry, BankMatch } from './matcher';

export const ROUTER_SYSTEM_PROMPT =
  `You are a precise router for a software engineer's interview question bank. ` +
  `The transcript block below contains a NUMBERED list of the candidate's prepared ` +
  `answers, each shown by its title and topic. The user's message contains the ` +
  `interviewer's question.\n\n` +
  `Decide which prepared answer best answers the interviewer's question. Reply with ` +
  `ONLY that number. If a few are genuinely relevant, reply with up to their numbers ` +
  `separated by commas, best first. If none of them genuinely answer the question, ` +
  `reply with exactly NONE.\n\n` +
  `Never invent a number that is not in the list. Output only the number(s) or the ` +
  `word NONE — no titles, no explanation, no other text.`;

// The interviewer's question goes in the user message; the numbered manifest is
// supplied as context (composeAssistPrompt frames it as the transcript block).
export function routerUserMessage(query: string): string {
  return `Interviewer's question:\n${query.trim()}\n\nWhich prepared answer number fits? Reply with the number(s) or NONE.`;
}

// Compact manifest: one line per file — number, title, and a short topic line — so
// even a large bank (50–200 files) stays small enough for one call on any model.
export function buildManifest(entries: BankEntry[]): string {
  return entries
    .map((entry, i) => {
      const summary = summaryOf(entry);
      const tail = summary && summary.toLowerCase() !== entry.title.toLowerCase() ? ` — ${summary}` : '';
      return `${i + 1}. ${entry.title}${tail}`;
    })
    .join('\n');
}

// Parse the model's reply into valid 1-based indices (deduped, in range, capped).
// Handles "3", "3, 1", "Answer: 2", and NONE / no-digits → [].
export function parseSelection(reply: string, count: number, max: number): number[] {
  if (/\bnone\b/i.test(reply) && !/\d/.test(reply)) return [];
  const nums = (reply.match(/\d+/g) ?? [])
    .map((n) => parseInt(n, 10))
    .filter((n) => n >= 1 && n <= count);
  return [...new Set(nums)].slice(0, max);
}

export function toMatch(entry: BankEntry): BankMatch {
  return { path: entry.path, title: entry.title, snippet: summaryOf(entry) };
}

// The first non-heading, non-empty line — usually the question the file answers.
function summaryOf(entry: BankEntry): string {
  const line = entry.content
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0 && l.toLowerCase() !== entry.title.toLowerCase());
  const chosen = line ?? '';
  return chosen.length > 120 ? chosen.slice(0, 117) + '…' : chosen;
}
