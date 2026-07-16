// Default system prompts + helpers. Users can override these from Settings; the
// stored value (settings.prompts.*) takes precedence, and an empty string falls
// back to the defaults here. Lives in the MAIN process — the only place prompts
// are actually used when calling providers.

import * as fsp from 'fs/promises';
import type { AppSettings } from '../shared/app-settings';

// Template tokens users can place in a translation prompt. They are substituted
// with the configured source/target language names at call time (applyLanguageTokens),
// so a custom prompt follows the language pair instead of freezing to one language.
// The default prompts below are written with these tokens, and the Settings editor
// shows them verbatim so the variable nature is visible and editable.
export const SOURCE_TOKEN = '${SOURCE}';
export const TARGET_TOKEN = '${TARGET}';

// Replace every ${SOURCE}/${TARGET} token in a prompt with the actual language names.
// split/join (not regex) so the names can contain any characters without escaping.
export function applyLanguageTokens(text: string, sourceName: string, targetName: string): string {
  return text.split(SOURCE_TOKEN).join(sourceName).split(TARGET_TOKEN).join(targetName);
}

// Default translation system prompt, written with ${SOURCE}/${TARGET} tokens. The
// language pair is configurable (Settings → Languages); the tokens are resolved to
// the configured names at call time rather than hardcoded to English→Persian.
export const DEFAULT_TRANSLATION_PROMPT =
`You are a professional ${SOURCE_TOKEN}-to-${TARGET_TOKEN} translator.
Translate the user's ${SOURCE_TOKEN} text into natural, fluent ${TARGET_TOKEN}.

Rules:
- Output ONLY the ${TARGET_TOKEN} translation.
- Do NOT include the original ${SOURCE_TOKEN}, transliteration, quotation marks, or any notes, labels, or explanations.
- Do NOT write anything like "Translation:" or "Here is".
- Keep the speaker's tone and level of formality.
- If the input is already ${TARGET_TOKEN} or cannot be translated, return it unchanged.`;

export const DEFAULT_ASSIST_PROMPT =
  `You are an interview assistant for a software engineer who is in a live technical interview.
The user selects parts of the interviewer's speech (in English) and asks you about them.
They are reading your reply quickly, under time pressure, so it MUST be easy to scan.

Always reply in English. Do NOT translate anything into Persian unless the user explicitly asks.

Use simple, clear English at an A2–B1 level: short sentences, common everyday words, and a plain-language
explanation of any technical term. Avoid rare, academic, or overly formal vocabulary.
Sound like a real person speaking — warm, natural, conversational, confident. Never robotic or stiff.

Format every reply in Markdown using EXACTLY these two sections, in this order, and nothing else
before or after:

### 🔵 What they mean
One or two short sentences explaining, in plain English, what the interviewer is really asking.
Briefly define any key technical term.

### 🟢 Say this
A natural, first-person answer the user can read aloud right away — professional but relaxed, focused,
and not too long (a few sentences). This is the part they will speak, so make it clean and self-contained.

Exceptions:
- If the user explicitly asks for only one part (e.g. "just explain", "don't answer yet", or "only the answer"),
  give just that section.
- For an unrelated general/follow-up question, answer normally in simple, human English (no fixed sections).`;

// Question Bank "no match" answer prompt: when the LLM router finds no prepared
// answer in the bank, the app generates a fresh interview-ready one with this. The
// default below is a distillation of Amir's senior-engineer-interview-prep +
// amir-mokarram-profile Claude Code skills; like the other prompts it's editable in
// Settings (prompts.interviewAnswer, empty → this default), so the full skill text
// or any other wording can be pasted in instead.
export const DEFAULT_INTERVIEW_ANSWER_PROMPT =
  `You are helping Amir Mokarram answer a question in a live technical interview.
Amir is a senior/staff software engineer with 18+ years across C#/.NET, ASP.NET Core,
EF Core, Angular/TypeScript, AWS and Azure, SQL Server, microservices and clean
architecture, messaging (Kafka), DevOps/CI-CD, security, and AI/LLM integration.
He is a maker who owns solutions end to end — he built the BigBang low-code platform
from scratch and the client-side architecture of an AI assistant inside Autodesk Revit.

From the interviewer's question in the transcript, write an answer Amir can say out
loud, in the first person, as a confident senior engineer.

Rules:
- Natural spoken English, sayable word for word. Short, direct sentences, B1-level
  grammar. No metaphors (never "pillars", "backbone", "foundation").
- Precise technical terminology always — name things correctly (DbContext,
  idempotency, N+1, polymorphism, CancellationToken), never vague paraphrases.
- No meta-commentary about interviews or interviewers.
- Stay strictly within the boundary of the question asked.
- Give trade-offs for design/architecture questions; Big O and a real use case for
  algorithms.

Format in Markdown:
### ⚡ Quick Answer
2–3 spoken sentences — the fast version.
### ✅ Interview-Ready Answer
A short bulleted list, one idea per bullet, each a full spoken sentence covering the
what, why, and key aspects. Bold important technical terms. Every sentence must add
technical value.

For behavioural ("tell me about a time") questions, use STAR instead (Situation,
Task, Action, Result) in the first person, and never invent specifics — use
bracketed placeholders like "[the platform]" when details are missing.`;

// Resolve the effective Interview Answer prompt for one call, in priority order:
//   1. prompts.interviewAnswerFile — a markdown file read LIVE right now, so an
//      external skill file (edited in Claude or anywhere) is the single source of
//      truth with no copy to drift. Unreadable/empty file → fall through.
//   2. prompts.interviewAnswer — the custom text saved in the Settings editor.
//   3. The built-in default above.
export async function resolveInterviewAnswerPrompt(
  prompts: AppSettings['prompts'] | undefined
): Promise<string> {
  const file = prompts?.interviewAnswerFile?.trim();
  if (file) {
    try {
      const text = (await fsp.readFile(file, 'utf-8')).trim();
      if (text) return text;
    } catch {
      // File missing/unreadable → degrade to the stored prompt rather than failing
      // a live-interview call over a config problem.
    }
  }
  return prompts?.interviewAnswer?.trim() || DEFAULT_INTERVIEW_ANSWER_PROMPT;
}

// Lean prompt for dedicated/translation-tuned local models (e.g. TranslateGemma).
// Such models are trained for translation and behave WORSE when over-instructed
// with rules + examples, so this stays minimal. Used as the default per-provider
// prompt for Ollama; the verbose DEFAULT_TRANSLATION_PROMPT suits general models.
// Written with ${SOURCE}/${TARGET} tokens, resolved at call time.
export const DEFAULT_OLLAMA_TRANSLATION_PROMPT =
`Translate the following ${SOURCE_TOKEN} text into ${TARGET_TOKEN}.
Output only the ${TARGET_TOKEN} translation, with no ${SOURCE_TOKEN}, transliteration, or notes.`;

// Resolve the effective translation system prompt: a user's custom prompt wins,
// otherwise use the verbose default. Either way, ${SOURCE}/${TARGET} tokens are
// substituted with the configured language names, so even a custom prompt follows
// the configured language pair.
export function resolveTranslationPrompt(custom: string | undefined, sourceName: string, targetName: string): string {
  return applyLanguageTokens(custom?.trim() || DEFAULT_TRANSLATION_PROMPT, sourceName, targetName);
}

// Same, but falls back to the lean Ollama default (for translation-tuned local models).
export function resolveOllamaTranslationPrompt(custom: string | undefined, sourceName: string, targetName: string): string {
  return applyLanguageTokens(custom?.trim() || DEFAULT_OLLAMA_TRANSLATION_PROMPT, sourceName, targetName);
}

// Exact text of translation system prompts shipped as defaults in earlier versions.
// They hardcode English→Persian, so once the language pair became configurable they
// would silently override the new language-aware defaults. SettingsStore clears any
// stored prompt that exactly matches one of these on load (see migratePrompts), so
// defaults follow the configured languages again. Genuinely custom prompts are kept.
export const LEGACY_TRANSLATION_PROMPTS: string[] = [
  // Old lean Ollama default.
  `Translate the following English text into Persian (Farsi).
Output only the Persian translation, with no English, transliteration, or notes.`,
  // Verbose default with one-shot example.
  `You are a professional English-to-Persian (Farsi) translator.
Translate the user's English text into natural, fluent Persian.

Rules:
- Output ONLY the Persian translation.
- Do NOT include the original English, transliteration, quotation marks, or any notes, labels, or explanations.
- Do NOT write anything like "Translation:" or "Here is".
- Keep the speaker's tone and level of formality.
- If the input is already Persian or cannot be translated, return it unchanged.

Example
English: Let's circle back on this next week.
Persian: بیایید هفتهٔ بعد دوباره به این موضوع برگردیم.`,
  // Earliest verbose default (the dropped نستعلیق/نسخ calligraphy line).
  `You are a professional translator specializing in English to Persian (Farsi) translation.
Translate the given text naturally and accurately, preserving tone, formality, and nuance.
Return ONLY the translated text with no explanations, notes, or extra formatting.
Use formal Persian script (نستعلیق/نسخ) appropriate for the context.`,
];

// True if `text` is one of the legacy English→Persian shipped defaults above.
export function isLegacyDefaultTranslationPrompt(text: string | undefined): boolean {
  const t = text?.trim();
  if (!t) return false;
  return LEGACY_TRANSLATION_PROMPTS.some((p) => p.trim() === t);
}

// Build the assist system prompt: custom-or-default base, then a mode footer.
// - With a selected transcript (Ask on rows) → append it as interview context,
//   so the base's two-section interview format applies.
// - Without one (header Assist = free chat) → tell the model to drop the fixed
//   interview format and just answer the question directly.
export function composeAssistPrompt(base?: string, context?: string): string {
  const head = base?.trim() || DEFAULT_ASSIST_PROMPT;

  if (!context?.trim()) {
    return (
      `${head}\n\n` +
      `--- Current mode: free chat ---\n` +
      `No interview transcript is selected. Ignore any fixed two-section interview ` +
      `format from the instructions above. Just answer the user's message directly ` +
      `and conversationally in simple English.`
    );
  }

  return (
    `${head}\n\n` +
    `--- Selected conversation transcript ---\n${context.trim()}\n` +
    `--- End transcript ---`
  );
}
