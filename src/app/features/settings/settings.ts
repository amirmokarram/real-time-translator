import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../core/services/settings.service';
import { ElectronBridgeService } from '../../core/services/electron-bridge.service';
import { ProviderMeta } from '../../core/models/app.models';

interface ProviderFormState {
  fields: Record<string, string>;
  validating: boolean;
  validResult: { valid: boolean; error?: string } | null;
  expanded: boolean;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent implements OnInit {
  protected settingsSvc = inject(SettingsService);
  protected bridge = inject(ElectronBridgeService);

  protected providerStates = signal<Record<string, ProviderFormState>>({});
  protected activeTab = signal<'translation' | 'stt' | 'display'>('translation');
  protected saving = signal(false);
  protected saveSuccess = signal(false);

  // STT (DeepGram)
  protected sttApiKey = signal('');
  protected sttSaving = signal(false);
  protected sttValidating = signal(false);
  protected sttValidResult = signal<{ valid: boolean; error?: string } | null>(null);

  async ngOnInit(): Promise<void> {
    const settings = this.settingsSvc.settings();
    const providers = this.settingsSvc.providers();
    const states: Record<string, ProviderFormState> = {};

    for (const p of providers) {
      const saved = settings?.providers[p.id] ?? {};
      const fields: Record<string, string> = {};
      for (const f of p.configFields) {
        fields[f.key] = (saved as Record<string, string>)[f.key] ?? '';
      }
      states[p.id] = {
        fields,
        validating: false,
        validResult: null,
        expanded: p.id === this.settingsSvc.activeProvider(),
      };
    }

    this.providerStates.set(states);
    this.sttApiKey.set(settings?.stt.apiKey ?? '');
  }

  protected toggleExpand(id: string): void {
    this.providerStates.update((s) => ({
      ...s,
      [id]: { ...s[id], expanded: !s[id].expanded },
    }));
  }

  protected setField(providerId: string, key: string, value: string): void {
    this.providerStates.update((s) => ({
      ...s,
      [providerId]: {
        ...s[providerId],
        fields: { ...s[providerId].fields, [key]: value },
        validResult: null,
      },
    }));
  }

  protected async saveProvider(p: ProviderMeta): Promise<void> {
    const state = this.providerStates()[p.id];
    if (!state) return;
    this.saving.set(true);
    try {
      await this.settingsSvc.updateProviderSettings(p.id, state.fields);
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 2000);
    } finally {
      this.saving.set(false);
    }
  }

  protected async validateProvider(p: ProviderMeta): Promise<void> {
    const state = this.providerStates()[p.id];
    if (!state) return;

    await this.settingsSvc.updateProviderSettings(p.id, state.fields);

    this.providerStates.update((s) => ({
      ...s,
      [p.id]: { ...s[p.id], validating: true, validResult: null },
    }));

    try {
      const result = await this.bridge.validateProvider(p.id);
      this.providerStates.update((s) => ({
        ...s,
        [p.id]: { ...s[p.id], validating: false, validResult: result },
      }));
    } catch (err: unknown) {
      this.providerStates.update((s) => ({
        ...s,
        [p.id]: {
          ...s[p.id],
          validating: false,
          validResult: { valid: false, error: err instanceof Error ? err.message : String(err) },
        },
      }));
    }
  }

  protected stateOf(id: string): ProviderFormState | null {
    return this.providerStates()[id] ?? null;
  }

  protected getFieldValue(providerId: string, key: string): string {
    return this.providerStates()[providerId]?.fields[key] ?? '';
  }

  protected async saveSttKey(): Promise<void> {
    this.sttSaving.set(true);
    this.sttValidResult.set(null);
    try {
      await this.settingsSvc.updateStt({ apiKey: this.sttApiKey() });
    } finally {
      this.sttSaving.set(false);
    }
  }

  protected async testSttConnection(): Promise<void> {
    const key = this.sttApiKey().trim();
    if (!key) return;
    await this.settingsSvc.updateStt({ apiKey: key });
    this.sttValidating.set(true);
    this.sttValidResult.set(null);

    try {
      const result = await this.testDeepGram(key);
      this.sttValidResult.set(result);
    } catch (err: unknown) {
      this.sttValidResult.set({ valid: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.sttValidating.set(false);
    }
  }

  private testDeepGram(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return new Promise((resolve) => {
      const ws = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2', ['token', apiKey]);
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ valid: false, error: 'Connection timed out' });
      }, 6000);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close(1000);
        resolve({ valid: true });
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ valid: false, error: 'Connection refused — check your API key' });
      };

      ws.onclose = (ev) => {
        clearTimeout(timeout);
        if (ev.code === 1008) {
          resolve({ valid: false, error: 'Invalid API key (policy violation)' });
        }
      };
    });
  }

  protected async setFontSize(value: number): Promise<void> {
    await this.settingsSvc.updateDisplay({ fontSize: value });
  }

  protected async toggleInterim(value: boolean): Promise<void> {
    await this.settingsSvc.updateDisplay({ showInterimResults: value });
  }
}
