import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  platform: process.platform,

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),

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

  onAssistChunk: (cb: (chunk: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: string) => cb(chunk);
    ipcRenderer.on('assist:chunk', handler);
    return () => ipcRenderer.removeListener('assist:chunk', handler);
  },

  onAssistComplete: (cb: (text: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on('assist:complete', handler);
    return () => ipcRenderer.removeListener('assist:complete', handler);
  },

  onOverlayState: (cb: (open: boolean) => void) => {
    const handler = (_: Electron.IpcRendererEvent, open: boolean) => cb(open);
    ipcRenderer.on('overlay:state', handler);
    return () => ipcRenderer.removeListener('overlay:state', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
