// Builds the settings.json seeded into each test's temp userData dir so the app
// boots straight into a deterministic, network-free configuration: the scripted
// 'mock' STT backend and the 'echo' translation/assist providers. Shape mirrors
// the defaults in electron/settings-store.ts (only the E2E-relevant fields differ).

export interface SeedOverrides {
  livePartial?: boolean;
  commitOnClause?: boolean;
}

export function buildSeedSettings(overrides: SeedOverrides = {}): unknown {
  return {
    activeProvider: 'echo',
    providers: {
      claude: { model: 'claude-sonnet-4-6' },
      openai: { model: 'gpt-4o-mini' },
      echo: {},
    },
    languages: { source: 'en', target: 'fa' },
    stt: {
      provider: 'mock',
      apiKey: 'e2e',
      endpoint: 'ws://localhost:9090',
      model: 'small',
      useVad: false,
      endpointingMs: 800,
      utteranceEndMs: 1000,
      sentenceMaxWaitMs: 1000,
      commitOnClause: overrides.commitOnClause ?? false,
      livePartial: overrides.livePartial ?? false,
      partialDebounceMs: 100,
    },
    assist: { provider: 'echo', model: 'echo', endpoint: 'http://localhost:11434' },
    prompts: { assist: '', translation: '' },
    audio: { selectedSourceId: null },
    display: { fontSize: 16, showInterimResults: true, historyLength: 50 },
  };
}
