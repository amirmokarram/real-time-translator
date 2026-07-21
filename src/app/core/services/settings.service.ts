import { Injectable, inject, signal } from '@angular/core';
import { AppSettings, ProviderMeta } from '../models/app.models';
import { ElectronBridgeService } from './electron-bridge.service';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private bridge = inject(ElectronBridgeService);

  readonly settings = signal<AppSettings | null>(null);
  readonly providers = signal<ProviderMeta[]>([]);
  readonly loaded = signal(false);

  async init(): Promise<void> {
    const [settings, providers] = await Promise.all([
      this.bridge.getSettings(),
      this.bridge.getAvailableProviders(),
    ]);
    this.settings.set(settings);
    this.providers.set(providers);
    this.loaded.set(true);
  }

  activeProvider(): string {
    return this.settings()?.activeProvider ?? 'claude';
  }

  providerMeta(id: string): ProviderMeta | undefined {
    return this.providers().find((p) => p.id === id);
  }

  async setActiveProvider(id: string): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, activeProvider: id };
    this.settings.set(updated);
    await this.bridge.saveSettings({ activeProvider: id });
  }

  async updateProviderSettings(
    providerId: string,
    providerSettings: Record<string, string>
  ): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated: AppSettings = {
      ...current,
      providers: {
        ...current.providers,
        [providerId]: { ...current.providers[providerId], ...providerSettings },
      },
    };
    this.settings.set(updated);
    await this.bridge.saveSettings({ providers: updated.providers });
  }

  async updateLanguages(partial: Partial<AppSettings['languages']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, languages: { ...current.languages, ...partial } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ languages: updated.languages });
  }

  async updateStt(partial: Partial<AppSettings['stt']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, stt: { ...current.stt, ...partial } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ stt: updated.stt });
  }

  async updateAssist(partial: Partial<AppSettings['assist']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, assist: { ...current.assist, ...partial } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ assist: updated.assist });
  }

  async updatePrompts(partial: Partial<AppSettings['prompts']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, prompts: { ...current.prompts, ...partial } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ prompts: updated.prompts });
  }

  async updateQuestionBank(partial: Partial<AppSettings['questionBank']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, questionBank: { ...current.questionBank, ...partial } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ questionBank: updated.questionBank });
  }

  async updateRecording(partial: Partial<AppSettings['recording']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, recording: { ...current.recording, ...partial } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ recording: updated.recording });
  }

  async updateDisplay(display: Partial<AppSettings['display']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, display: { ...current.display, ...display } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ display: updated.display });
  }

  async updateTray(partial: Partial<AppSettings['tray']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, tray: { ...current.tray, ...partial } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ tray: updated.tray });
  }

  async updateHotkeys(partial: Partial<AppSettings['hotkeys']>): Promise<void> {
    const current = this.settings();
    if (!current) return;
    const updated = { ...current, hotkeys: { ...current.hotkeys, ...partial } };
    this.settings.set(updated);
    await this.bridge.saveSettings({ hotkeys: updated.hotkeys });
  }
}
