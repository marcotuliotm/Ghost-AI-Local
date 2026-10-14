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
    model: string
    messages: OllamaMessage[]
    baseUrl: string
    options?: { num_ctx?: number }
  }) => ipcRenderer.invoke('ollama-chat-stream', payload),

  ollamaListModels: (baseUrl: string) =>
    ipcRenderer.invoke('ollama-list-models', baseUrl),

  ollamaCheck: (baseUrl: string) =>
    ipcRenderer.invoke('ollama-check', baseUrl),

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
  onStreamChunk: (callback: (chunk: string) => void) => {
    const handler = (_event: any, chunk: string) => callback(chunk)
    ipcRenderer.on('ollama-stream-chunk', handler)
    return () => ipcRenderer.removeListener('ollama-stream-chunk', handler)
  },

  onStreamDone: (callback: (fullResponse: string) => void) => {
    const handler = (_event: any, response: string) => callback(response)
    ipcRenderer.on('ollama-stream-done', handler)
    return () => ipcRenderer.removeListener('ollama-stream-done', handler)
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

  onOverlayVisibility: (callback: (visible: boolean) => void) => {
    const handler = (_event: any, visible: boolean) => callback(visible)
    ipcRenderer.on('overlay-visibility', handler)
    return () => ipcRenderer.removeListener('overlay-visibility', handler)
  },
}

contextBridge.exposeInMainWorld('ghostAPI', api)
