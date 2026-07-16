import { globalShortcut } from 'electron';
import type { AppSettings } from '../shared/app-settings';

type HotkeyName = keyof AppSettings['hotkeys'];

/**
 * Registers the configurable global hotkeys (system-wide, work while another
 * app is focused). apply() is idempotent — call it again after every settings
 * save so edits take effect without a restart. A combo another app already
 * owns, or an invalid accelerator string, is skipped with a warning — never a
 * crash. E2E runs register nothing: CI must not grab system-wide keys.
 */
export class HotkeyManager {
  constructor(private readonly actions: Record<HotkeyName, () => void>) {}

  apply(hotkeys: AppSettings['hotkeys']): void {
    if (process.env['TRANSLATOR_E2E']) return;
    globalShortcut.unregisterAll();

    for (const [name, accelerator] of Object.entries(hotkeys) as [HotkeyName, string][]) {
      if (!accelerator) continue; // '' = disabled by the user
      const action = this.actions[name];
      if (!action) continue; // stale key in settings.json — ignore
      try {
        if (!globalShortcut.register(accelerator, action)) {
          console.warn(`[hotkeys] "${accelerator}" (${name}) is taken by another app — skipped`);
        }
      } catch {
        console.warn(`[hotkeys] invalid accelerator "${accelerator}" (${name}) — skipped`);
      }
    }
  }

  /** will-quit cleanup — global shortcuts outlive windows, not the app. */
  dispose(): void {
    globalShortcut.unregisterAll();
  }
}
