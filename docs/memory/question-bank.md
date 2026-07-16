---
name: question-bank
description: "Question Bank feature — LLM-routed prepared-answer lookup from the assist panel, with a generated interview-ready answer fallback"
metadata: 
  node_type: memory
  type: project
  originSessionId: 804b9845-9292-466a-bc2b-b724035aa687
---

# Question Bank (built 2026-07-16, Amir confirmed good; committed as 2da3737)

**What it is:** Amir keeps a local folder of markdown interview Q&A files (descriptive
filenames, `# heading` = the question, body = his prepared answer, English, ~50–200
files). During a live interview he selects transcript rows → **Ask** → assist panel →
**Query From Q Bank**. One LLM call decides which prepared file answers the
interviewer's question; if none fits, the app generates a fresh interview-ready answer.
**No MCP anywhere** — deliberately rejected: the app IS the host; main process reaches
its own filesystem directly (see the architecture rule in [[project-architecture]]).

## The decision history (why it's built this way)
1. First build used a code-side keyword matcher + RAG content injection.
2. Amir redefined it: **accuracy is the only priority → the LLM selects the file**,
   and a *match means done* (he opens & reads his own answer — no generation, no
   injection). Only a *no-match* generates an answer.
3. Key insight that unlocked LLM selection on all 4 assist providers (incl. local
   Ollama): manifest-in-prompt selection is plain text-in/text-out, **not
   tool-calling** — no function-calling API needed.
4. Hardcoded prompts were called out by Amir → moved into the centralized
   settings/prompts system like everything else.

## Flow (renderer `AssistService.queryFromBank()`)
- Query = the `context` signal (selected rows, English source — never the Persian
  translation). Button lives in the assist panel quick-actions (empty-thread state),
  shown only when a bank folder is configured.
- `bank:route` IPC (main): builds a **numbered manifest** (title + first content line
  per file — compact, fits local models at 50–200 files), asks the **configured
  assist provider** (settings.assist) with `ROUTER_SYSTEM_PROMPT`, parses the reply
  via `parseSelection()` (numbers validated against the real list → hallucinated
  filenames impossible; NONE → []). LLM call fails → silent fallback to
  `keywordSearch()` (matcher.ts, demoted to fallback-only).
- Match → `bankMatches` signal → clickable cards (`bank:open`, `shell.openPath`,
  path must be one that was indexed — never an arbitrary renderer path). Done.
- No match → `ask(INTERVIEW_ANSWER_INSTRUCTION, undefined, 'interviewAnswer')` —
  streams a generated first-person answer.

## Prompt architecture (the principle Amir enforced)
- **Content prompts → Settings; protocol prompts → code.** `ROUTER_SYSTEM_PROMPT`
  stays in code because `parseSelection()` depends on its output contract
  ("number(s) or NONE").
- The no-match **Interview Answer prompt** resolves in MAIN
  (`resolveInterviewAnswerPrompt` in electron/prompts.ts), priority:
  1. `prompts.interviewAnswerFile` — a markdown file **read live on every call**
     (so Amir's Claude skill file is the single source of truth, no copy drift;
     picked via `prompts:pick-interview-file` dialog);
  2. `prompts.interviewAnswer` — Settings editor text (stores `''` when it equals
     the default — the freeze-safe rule from [[translation-providers]]);
  3. `DEFAULT_INTERVIEW_ANSWER_PROMPT` — a distillation of Amir's
     senior-engineer-interview-prep + amir-mokarram-profile Claude Code skills
     (skills can't be invoked by the app at runtime; also the full SKILL.md contains
     Interviewer-Mode/simulation/rating instructions that would misdirect a one-shot
     answer, and its 21 references/*.md progressive-disclosure files can't fit a
     static prompt).
- Renderer sends only `promptKind: 'assist' | 'interviewAnswer'` on the assist
  payload — never raw prompt text over IPC.

## Files
- `electron/question-bank/`: `question-bank.ts` (folder index: recursive `*.md` scan,
  lazy rebuild, `fs.watch` recursive invalidation, guarded `open()`),
  `router.ts` (router prompt + manifest + `parseSelection` — pure, node-testable),
  `matcher.ts` (keyword fallback only).
- IPC: `bank:route`, `bank:open`, `bank:pick-folder`, `prompts:pick-interview-file`;
  `assist:ask` gained `promptKind`.
- Settings: `questionBank: { folderPath, maxResults }` (+ Settings → General rows);
  `prompts.interviewAnswer` + `prompts.interviewAnswerFile` (+ second editor card
  with file Browse/Clear under Settings → Assist → System Prompt).
- Renderer: `AssistService` (`bankMatches`/`bankSearching` signals, `queryFromBank`,
  `ask(question, contextOverride?, promptKind?)`), assist-panel cards + button,
  `BankMatch = { path, title, snippet }`.

## E2E coverage (added 2026-07-16)
`e2e/question-bank.spec.ts` covers the panel path: match → card, no-match → generated
answer, button hidden without a folder. Deterministic via the **echo-digit routing
trick** (digit in the question = manifest number; no digit = NONE) against
`e2e/bank-fixtures/` — see [[e2e-testing]] for the mechanism.

## Deferred / discussed
- **Phase 2 — live trigger: BUILT 2026-07-16, then REMOVED same day at Amir's
  request. Do NOT re-propose.** Full implementation existed and was verified
  working end-to-end (E2E suite + a scripted run of the real app with his real
  bank/Claude config routed a typed question to the right file). Amir still
  rejected it after hands-on testing: *"live question bank query is not useful
  and not accurate, accuracy is important for me."* The auto-trigger
  (`?` + ≥4 words on committed/typed sentences) fires on the wrong things and a
  single spoken sentence lacks the context he curates by hand — selection IS the
  accuracy step, so routing must stay manual. All Phase 2 code was reverted
  (settings `liveSuggest`, BankSuggestService, chip bar, the live e2e spec —
  the bank fixtures were later reused by the Phase 1 panel spec);
  the **manual panel "Query From Q Bank" remains the only routing path**.
  If hands-free ever comes back, it needs a fundamentally more accurate trigger
  (not sentence-shape heuristics), not a rebuild of this design.
- **In-app progressive disclosure (option B, not built):** replicate the skill's
  domain→reference-file table so the generated answer gets reference-level depth.
- Embeddings phase became mostly moot once selection went LLM-side.
- "Query From Q Bank" is only reachable in an empty thread (by design for now).
