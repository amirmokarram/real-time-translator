import { IpcMain, BrowserWindow, IpcMainInvokeEvent, dialog } from 'electron';
import * as fs from 'fs/promises';
import { SettingsStore } from './settings-store';
import { AudioCapture } from './audio-capture';
import { OverlayManager } from './overlay-window';
import { ProviderRegistry } from './translation/provider-registry';
import { TranslationRequest } from './translation/provider.interface';
import { AssistRegistry } from './assist/assist-registry';
import { AssistMessage } from './assist/assist.interface';
import {
  DEFAULT_ASSIST_PROMPT,
  DEFAULT_INTERVIEW_ANSWER_PROMPT,
  DEFAULT_TRANSLATION_PROMPT,
  resolveInterviewAnswerPrompt,
} from './prompts';
import { languageName } from './languages';
import { QuestionBank } from './question-bank/question-bank';
import { BankMatch } from './question-bank/matcher';
import {
  ROUTER_SYSTEM_PROMPT,
  routerUserMessage,
  buildManifest,
  parseSelection,
  toMatch,
} from './question-bank/router';

const audioCapture = new AudioCapture();
const registry = new ProviderRegistry();
const assistRegistry = new AssistRegistry();

// Collapse a run of repeated terminal punctuation (e.g. "؟؟", "??", "؟?", "!!")
// into a single mark. Some NMT models (notably LibreTranslate/Argos) duplicate
// the sentence-final question mark when translating questions; this fixes that
// for every provider. Prefers the Persian "؟" when the run contains one.
function collapseTerminalPunctuation(text: string): string {
  return text.replace(/[?!؟](?:\s*[?!؟])+/g, (run) =>
    run.includes('؟') ? '؟' : run.includes('?') ? '?' : '!'
  );
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  win: BrowserWindow,
  settingsStore: SettingsStore,
  overlayManager: OverlayManager
): void {
  const questionBank = new QuestionBank(settingsStore);

  // Send an event to every open window (main + overlay)
  const broadcast = (channel: string, ...args: unknown[]): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, ...args);
    }
  };

  // ── Window controls (main window) ──────────────────────────────────────────
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:maximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('window:is-maximized', () => win.isMaximized());

  // ── Settings ────────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => settingsStore.get());
  ipcMain.handle('settings:save', async (_event, partial: unknown) => {
    await settingsStore.update(partial as Parameters<typeof settingsStore.update>[0]);
  });

  // ── Audio ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('audio:get-sources', () => audioCapture.getSources());
  ipcMain.handle('audio:start-capture', (_event, sourceId: string) => {
    audioCapture.startCapture(sourceId);
  });
  ipcMain.handle('audio:stop-capture', () => audioCapture.stopCapture());

  // ── Translation providers metadata ─────────────────────────────────────────
  ipcMain.handle('translation:get-providers', () => registry.getAllMeta());

  // ── Translate (broadcasts to main + overlay) ───────────────────────────────
  ipcMain.handle('translation:translate', async (_event, payload: unknown) => {
    const { text, providerId } = payload as { text: string; providerId: string };
    const settings = settingsStore.get();
    const providerSettings = settings.providers[providerId] ?? {};
    const provider = registry.get(providerId);

    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const request: TranslationRequest = {
      text,
      sourceLang: settings.languages.source,
      targetLang: settings.languages.target,
      sourceLangName: languageName(settings.languages.source),
      targetLangName: languageName(settings.languages.target),
      // Per-provider override wins (e.g. a lean prompt for Ollama/TranslateGemma);
      // otherwise fall back to the global translation prompt, then the default.
      systemPrompt: providerSettings.prompt?.trim() || settings.prompts?.translation,
    };

    // Tell all windows what source text we're about to translate
    broadcast('translation:source', text);

    const onChunk = provider.meta.supportsStreaming
      ? (chunk: string) => broadcast('translation:chunk', chunk)
      : undefined;

    const result = await provider.translate(request, providerSettings, onChunk);
    result.translatedText = collapseTerminalPunctuation(result.translatedText);
    broadcast('translation:complete', result.translatedText);
    return result;
  });

  // ── Partial/preview translate (live-partial feature) ───────────────────────
  // Translates in-progress speech for the live preview. Deliberately does NOT
  // broadcast (keeps the overlay on committed rows only) and does NOT stream
  // chunks (so it can't contaminate a concurrent committed translate's stream).
  ipcMain.handle('translation:translate-partial', async (_event, payload: unknown) => {
    const { text, providerId } = payload as { text: string; providerId: string };
    const settings = settingsStore.get();
    const providerSettings = settings.providers[providerId] ?? {};
    const provider = registry.get(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const request: TranslationRequest = {
      text,
      sourceLang: settings.languages.source,
      targetLang: settings.languages.target,
      sourceLangName: languageName(settings.languages.source),
      targetLangName: languageName(settings.languages.target),
      systemPrompt: providerSettings.prompt?.trim() || settings.prompts?.translation,
    };

    const result = await provider.translate(request, providerSettings);
    result.translatedText = collapseTerminalPunctuation(result.translatedText);
    return result;
  });

  // ── Validate provider config ────────────────────────────────────────────────
  ipcMain.handle('translation:validate', async (_event, payload: unknown) => {
    const { providerId } = payload as { providerId: string };
    const settings = settingsStore.get();
    const providerSettings = settings.providers[providerId] ?? {};
    const provider = registry.get(providerId);
    if (!provider) return { valid: false, error: 'Unknown provider' };
    return provider.validate(providerSettings);
  });

  // ── Assist (LLM Q&A about the conversation) ──────────────────────────────────
  // Streamed to the calling window only (not broadcast — the overlay has no chat).
  // Reuses the matching translation provider's API key; model comes from settings.assist.
  ipcMain.handle('assist:ask', async (event, payload: unknown) => {
    const { messages, context, promptKind } = payload as {
      messages: AssistMessage[];
      context?: string;
      promptKind?: 'assist' | 'interviewAnswer';
    };
    const settings = settingsStore.get();
    const assistCfg = settings.assist;
    const provider = assistRegistry.get(assistCfg.provider);
    if (!provider) throw new Error(`Unknown assist provider: ${assistCfg.provider}`);

    const apiKey = settings.providers[assistCfg.provider]?.apiKey;
    const onChunk = (chunk: string) => event.sender.send('assist:chunk', chunk);

    // Prompt resolution stays in MAIN (same as translation): the renderer only
    // names which prompt to use. 'interviewAnswer' = the Question Bank no-match
    // branch; resolved live (file → stored custom → built-in default).
    const systemPrompt =
      promptKind === 'interviewAnswer'
        ? await resolveInterviewAnswerPrompt(settings.prompts)
        : settings.prompts?.assist;

    const full = await provider.ask(
      { messages, context, systemPrompt },
      { apiKey, model: assistCfg.model, endpoint: assistCfg.endpoint },
      onChunk
    );
    event.sender.send('assist:complete', full);
    return full;
  });

  // Verify the configured assist provider works: a minimal non-streaming call.
  // Reads saved settings, so the renderer should persist the form first.
  ipcMain.handle('assist:validate', async () => {
    const settings = settingsStore.get();
    const assistCfg = settings.assist;
    const provider = assistRegistry.get(assistCfg.provider);
    if (!provider) return { valid: false, error: `Unknown assist provider: ${assistCfg.provider}` };

    const apiKey = settings.providers[assistCfg.provider]?.apiKey;
    try {
      await provider.ask(
        { messages: [{ role: 'user', content: 'ping' }] },
        { apiKey, model: assistCfg.model, endpoint: assistCfg.endpoint }
      );
      return { valid: true };
    } catch (err: unknown) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Question Bank (local folder of markdown Q&A files) ───────────────────────
  // Route = accuracy-first selection: ask the configured assist LLM which prepared
  // answer (if any) fits the interviewer's question. Returns the matching files as
  // cards; an empty array means "no prepared answer" (renderer then generates one).
  // Falls back to offline keyword matching only if the LLM call fails.
  ipcMain.handle('bank:route', async (_event, query: unknown): Promise<BankMatch[]> => {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const entries = await questionBank.getEntries();
    if (entries.length === 0) return [];

    const settings = settingsStore.get();
    const assistCfg = settings.assist;
    const provider = assistRegistry.get(assistCfg.provider);
    const max = Math.max(1, settings.questionBank.maxResults || 3);
    if (!provider) return questionBank.keywordSearch(q);

    try {
      const reply = await provider.ask(
        {
          messages: [{ role: 'user', content: routerUserMessage(q) }],
          context: buildManifest(entries),
          systemPrompt: ROUTER_SYSTEM_PROMPT,
        },
        {
          apiKey: settings.providers[assistCfg.provider]?.apiKey,
          model: assistCfg.model,
          endpoint: assistCfg.endpoint,
        }
      );
      const picks = parseSelection(reply, entries.length, max);
      return picks.map((n) => toMatch(entries[n - 1]));
    } catch {
      // LLM unreachable → degrade to offline keyword matching rather than failing.
      return questionBank.keywordSearch(q);
    }
  });
  ipcMain.handle('bank:open', (_event, filePath: unknown) =>
    questionBank.open(String(filePath ?? ''))
  );
  // Native file picker for the "Interview Answer prompt file" setting: a markdown
  // file (e.g. inside a Claude skill folder) read live as the no-match prompt.
  ipcMain.handle('prompts:pick-interview-file', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose the Interview Answer prompt file',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown / Text', extensions: ['md', 'mdx', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  // Native folder picker for the Settings → General "Question Bank Folder" row.
  ipcMain.handle('bank:pick-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose your Question Bank folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  // ── Default system prompts (for the Settings editor + Reset) ─────────────────
  // The translation default carries ${SOURCE}/${TARGET} tokens (resolved to the
  // configured language names at call time), so it's language-independent and the
  // editor shows the tokens verbatim.
  ipcMain.handle('prompts:get-defaults', () => {
    return {
      assist: DEFAULT_ASSIST_PROMPT,
      translation: DEFAULT_TRANSLATION_PROMPT,
      interviewAnswer: DEFAULT_INTERVIEW_ANSWER_PROMPT,
    };
  });

  // ── Export history to file ──────────────────────────────────────────────────
  ipcMain.handle('export:save', async (_event, payload: unknown) => {
    const { content, defaultName } = payload as { content: string; defaultName: string };

    // E2E only: skip the native save dialog and write to a fixed path so a test
    // can read back and assert the exported content.
    const e2ePath = process.env['TRANSLATOR_E2E'] && process.env['TRANSLATOR_E2E_EXPORT_PATH'];
    if (e2ePath) {
      await fs.writeFile(e2ePath, content, 'utf-8');
      return { saved: true, path: e2ePath };
    }

    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [
        { name: 'Subtitles', extensions: ['srt'] },
        { name: 'Text', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, content, 'utf-8');
    return { saved: true, path: result.filePath };
  });

  // ── Overlay window ──────────────────────────────────────────────────────────
  ipcMain.handle('overlay:toggle', () => overlayManager.toggle());
  ipcMain.handle('overlay:is-open', () => overlayManager.isOpen());
  ipcMain.handle('overlay:close', () => overlayManager.close());

  // Per-window click-through. Called by the overlay on its own webContents.
  ipcMain.handle(
    'overlay:set-mouse-ignore',
    (event: IpcMainInvokeEvent, ignore: boolean, forward: boolean) => {
      const sender = BrowserWindow.fromWebContents(event.sender);
      if (!sender || sender.isDestroyed()) return;
      if (ignore) {
        sender.setIgnoreMouseEvents(true, { forward });
      } else {
        sender.setIgnoreMouseEvents(false);
      }
    }
  );
}
