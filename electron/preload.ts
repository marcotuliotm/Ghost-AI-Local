import { contextBridge, ipcRenderer } from 'electron'

export type OllamaMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OllamaModel = {
  name: string
  size: number
  digest: string
  modified_at: string
}

const api = {
  // Ollama
  ollamaChat: (payload: {
    model: string
    messages: OllamaMessage[]
    baseUrl: string
    options?: { num_ctx?: number }
    think?: boolean
  }) => ipcRenderer.invoke('ollama-chat', payload),

  ollamaChatStream: (payload: {
    requestId: string
    model: string
    messages: OllamaMessage[]
    baseUrl: string
    options?: { num_ctx?: number }
    think?: boolean
  }) => ipcRenderer.invoke('ollama-chat-stream', payload),

  ollamaAbort: (requestId: string) => ipcRenderer.invoke('ollama-abort', requestId),

  ollamaStatus: (baseUrl: string) => ipcRenderer.invoke('ollama-status', baseUrl),

  // Screenshot
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  captureScreenshotCrop: () => ipcRenderer.invoke('capture-screenshot-crop'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  setIgnoreMouse: (ignore: boolean) =>
    ipcRenderer.send('set-ignore-mouse', ignore),
  moveWindow: (x: number, y: number) =>
    ipcRenderer.send('window-move', { x, y }),
  resizeWindow: (width: number, height: number) =>
    ipcRenderer.send('window-resize', { width, height }),
  setOpacity: (opacity: number) =>
    ipcRenderer.send('set-opacity', opacity),
  setContentProtection: (enabled: boolean) =>
    ipcRenderer.send('set-content-protection', enabled),
  setCompactMode: (enabled: boolean) =>
    ipcRenderer.send('set-compact-mode', enabled),

  // Documents (local retrieval)
  docsList: () => ipcRenderer.invoke('docs-list'),
  docsAdd: (opts: { baseUrl: string; embeddingModel: string }) => ipcRenderer.invoke('docs-add', opts),
  docsRemove: (id: string) => ipcRenderer.invoke('docs-remove', id),
  docsSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('docs-set-enabled', id, enabled),
  docsReindex: (opts: { baseUrl: string; embeddingModel: string }) => ipcRenderer.invoke('docs-reindex', opts),
  docsSearch: (opts: { query: string; baseUrl: string; embeddingModel: string; k?: number; maxTokens?: number }) =>
    ipcRenderer.invoke('docs-search', opts),

  // First-run setup
  getScreenPermission: () => ipcRenderer.invoke('get-screen-permission'),
  openPrivacySettings: (kind: 'microphone' | 'screen') => ipcRenderer.invoke('open-privacy-settings', kind),

  // Global shortcuts
  shortcutsUpdate: (shortcuts: Record<string, string>) =>
    ipcRenderer.invoke('shortcuts-update', shortcuts),
  suspendShortcuts: (suspend: boolean) =>
    ipcRenderer.send('shortcuts-suspend', suspend),

  // Microphone
  requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),
  getMicStatus: () => ipcRenderer.invoke('get-mic-status'),

  // Whisper (local transcription)
  whisperLoad: (model: string) => ipcRenderer.invoke('whisper-load', model),
  whisperTranscribe: (audioBuffer: ArrayBuffer, language: string) =>
    ipcRenderer.invoke('whisper-transcribe', audioBuffer, language),
  whisperStatus: () => ipcRenderer.invoke('whisper-status'),

  // Speaker embedding (diarization)
  embedLoad: () => ipcRenderer.invoke('embed-load'),
  embedSpeaker: (audioBuffer: ArrayBuffer) =>
    ipcRenderer.invoke('embed-speaker', audioBuffer),
  embedStatus: () => ipcRenderer.invoke('embed-status'),

  // Save conversation / transcript (.txt) or meeting notes (.md)
  saveConversation: (payload: { content: string; suggestedName: string; format?: 'txt' | 'md' }) =>
    ipcRenderer.invoke('save-conversation', payload),

  // Settings persistence (electron-store)
  settingsLoad: () => ipcRenderer.invoke('settings-load'),
  settingsSave: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings-save', settings),

  // Clipboard (native, via main process)
  copyText: (text: string) => ipcRenderer.invoke('clipboard-write', text),

  onWhisperProgress: (callback: (data: { status: string; message: string; progress: number; model?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('whisper-progress', handler)
    return () => ipcRenderer.removeListener('whisper-progress', handler)
  },

  onEmbedProgress: (callback: (data: { status: string; message: string; progress: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('embed-progress', handler)
    return () => ipcRenderer.removeListener('embed-progress', handler)
  },

  // Events from main process
  onStreamChunk: (callback: (chunk: { requestId: string; content: string; thinking: string }) => void) => {
    const handler = (_event: any, chunk: { requestId: string; content: string; thinking: string }) => callback(chunk)
    ipcRenderer.on('ollama-stream-chunk', handler)
    return () => ipcRenderer.removeListener('ollama-stream-chunk', handler)
  },

  onScreenshotCaptured: (callback: (dataUrl: string) => void) => {
    const handler = (_event: any, dataUrl: string) => callback(dataUrl)
    ipcRenderer.on('screenshot-captured', handler)
    return () => ipcRenderer.removeListener('screenshot-captured', handler)
  },

  onFocusInput: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('focus-input', handler)
    return () => ipcRenderer.removeListener('focus-input', handler)
  },

  onOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('open-settings', handler)
    return () => ipcRenderer.removeListener('open-settings', handler)
  },

  onToggleCompact: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('toggle-compact', handler)
    return () => ipcRenderer.removeListener('toggle-compact', handler)
  },

  onOverlayVisibility: (callback: (visible: boolean) => void) => {
    const handler = (_event: any, visible: boolean) => callback(visible)
    ipcRenderer.on('overlay-visibility', handler)
    return () => ipcRenderer.removeListener('overlay-visibility', handler)
  },
}

contextBridge.exposeInMainWorld('ghostAPI', api)
