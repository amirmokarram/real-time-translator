import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  platform: process.platform,

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggle-always-on-top'),
  isAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
  resetSettings: (section: string) => ipcRenderer.invoke('settings:reset', section),

  // Audio sources
  getAudioSources: () => ipcRenderer.invoke('audio:get-sources'),
  startCapture: (sourceId: string) => ipcRenderer.invoke('audio:start-capture', sourceId),
  stopCapture: () => ipcRenderer.invoke('audio:stop-capture'),

  // Translation
  translate: (payload: unknown) => ipcRenderer.invoke('translation:translate', payload),
  translatePartial: (payload: unknown) => ipcRenderer.invoke('translation:translate-partial', payload),
  validateProvider: (payload: unknown) => ipcRenderer.invoke('translation:validate', payload),
  getAvailableProviders: () => ipcRenderer.invoke('translation:get-providers'),

  // Assist mode
  assist: (payload: unknown) => ipcRenderer.invoke('assist:ask', payload),
  validateAssist: () => ipcRenderer.invoke('assist:validate'),
  getDefaultPrompts: () => ipcRenderer.invoke('prompts:get-defaults'),
  pickInterviewPromptFile: () => ipcRenderer.invoke('prompts:pick-interview-file'),

  // Question Bank
  bankRoute: (query: string) => ipcRenderer.invoke('bank:route', query),
  bankOpen: (filePath: string) => ipcRenderer.invoke('bank:open', filePath),
  bankPickFolder: () => ipcRenderer.invoke('bank:pick-folder'),

  // Export
  exportFile: (payload: unknown) => ipcRenderer.invoke('export:save', payload),

  // Session recording — renderer owns the MediaRecorder, main owns the files
  recordingStart: (payload: unknown) => ipcRenderer.invoke('recording:start', payload),
  recordingChunk: (payload: unknown) => ipcRenderer.invoke('recording:chunk', payload),
  recordingStop: () => ipcRenderer.invoke('recording:stop'),
  recordingSaveTranscript: (payload: unknown) =>
    ipcRenderer.invoke('recording:save-transcript', payload),
  recordingPickFolder: () => ipcRenderer.invoke('recording:pick-folder'),
  recordingList: () => ipcRenderer.invoke('recording:list'),
  recordingSaveNotes: (payload: unknown) => ipcRenderer.invoke('recording:save-notes', payload),
  recordingReveal: (payload: unknown) => ipcRenderer.invoke('recording:reveal', payload),
  recordingDelete: (payload: unknown) => ipcRenderer.invoke('recording:delete', payload),

  // Overlay window
  toggleOverlay: () => ipcRenderer.invoke('overlay:toggle'),
  isOverlayOpen: () => ipcRenderer.invoke('overlay:is-open'),
  closeOverlay: () => ipcRenderer.invoke('overlay:close'),
  setOverlayMouseIgnore: (ignore: boolean, forward: boolean) =>
    ipcRenderer.invoke('overlay:set-mouse-ignore', ignore, forward),

  // Events from main → renderer
  onAudioLevel: (cb: (level: number) => void) => {
    const handler = (_: Electron.IpcRendererEvent, level: number) => cb(level);
    ipcRenderer.on('audio:level', handler);
    return () => ipcRenderer.removeListener('audio:level', handler);
  },

  onTranscriptionInterim: (cb: (text: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on('transcription:interim', handler);
    return () => ipcRenderer.removeListener('transcription:interim', handler);
  },

  onTranscriptionFinal: (cb: (text: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on('transcription:final', handler);
    return () => ipcRenderer.removeListener('transcription:final', handler);
  },

  onTranslationChunk: (cb: (chunk: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: string) => cb(chunk);
    ipcRenderer.on('translation:chunk', handler);
    return () => ipcRenderer.removeListener('translation:chunk', handler);
  },

  onTranslationComplete: (cb: (text: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on('translation:complete', handler);
    return () => ipcRenderer.removeListener('translation:complete', handler);
  },

  onTranslationSource: (cb: (text: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on('translation:source', handler);
    return () => ipcRenderer.removeListener('translation:source', handler);
  },

  // Assist stream events carry { requestId, text } so the renderer can ignore
  // chunks from a generation it has stopped listening to.
  onAssistChunk: (cb: (event: { requestId?: string; text: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: { requestId?: string; text: string }) =>
      cb(event);
    ipcRenderer.on('assist:chunk', handler);
    return () => ipcRenderer.removeListener('assist:chunk', handler);
  },

  onAssistComplete: (cb: (event: { requestId?: string; text: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: { requestId?: string; text: string }) =>
      cb(event);
    ipcRenderer.on('assist:complete', handler);
    return () => ipcRenderer.removeListener('assist:complete', handler);
  },

  onOverlayState: (cb: (open: boolean) => void) => {
    const handler = (_: Electron.IpcRendererEvent, open: boolean) => cb(open);
    ipcRenderer.on('overlay:state', handler);
    return () => ipcRenderer.removeListener('overlay:state', handler);
  },

  // Always-on-top state changes (any of the three controls) → sync the UIs.
  onAlwaysOnTopState: (cb: (on: boolean) => void) => {
    const handler = (_: Electron.IpcRendererEvent, on: boolean) => cb(on);
    ipcRenderer.on('window:always-on-top', handler);
    return () => ipcRenderer.removeListener('window:always-on-top', handler);
  },

  // Tray menu (later also global hotkeys) asking the renderer to start/stop
  // capture — getUserMedia has to run in the renderer.
  onToggleCaptureCommand: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('command:toggle-capture', handler);
    return () => ipcRenderer.removeListener('command:toggle-capture', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
