// Builds the settings.json seeded into each test's temp userData dir so the app
// boots straight into a deterministic, network-free configuration: the scripted
// 'mock' STT backend and the 'echo' translation/assist providers. Shape mirrors
// the defaults in electron/settings-store.ts (only the E2E-relevant fields differ).

export interface SeedOverrides {
  livePartial?: boolean;
  commitOnClause?: boolean;
  // Question Bank: point at a fixture folder of markdown Q&A files so the assist
  // panel's "Query From Q Bank" path is testable. Omitted → no bank configured.
  questionBank?: { folderPath: string; maxResults?: number };
  // Session recording. Off unless a test asks for it, so the other specs don't
  // write meeting files while exercising capture. `mode` defaults to 'source':
  // the fake media device gives us one usable input, and mixing a second one in
  // would only add moving parts to an assertion about files on disk.
  recording?: { enabled: boolean; folderPath?: string; mode?: string };
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
    ...(overrides.questionBank
      ? { questionBank: { maxResults: 3, ...overrides.questionBank } }
      : {}),
    prompts: { assist: '', translation: '' },
    audio: { selectedSourceId: null },
    recording: {
      enabled: false,
      folderPath: '',
      mode: 'source',
      micDeviceId: '',
      micGain: 100,
      bitrateKbps: 64,
      ...overrides.recording,
    },
    display: { fontSize: 16, showInterimResults: true, historyLength: 50 },
  };
}
