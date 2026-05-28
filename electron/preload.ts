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
  }) => ipcRenderer.invoke('ollama-chat', payload),

  ollamaChatStream: (payload: {
    model: string
    messages: OllamaMessage[]
    baseUrl: string
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
  whisperLoad: () => ipcRenderer.invoke('whisper-load'),
  whisperTranscribe: (audioBuffer: ArrayBuffer) =>
    ipcRenderer.invoke('whisper-transcribe', audioBuffer),
  whisperStatus: () => ipcRenderer.invoke('whisper-status'),

  // Save conversation
  saveConversation: (payload: { content: string; suggestedName: string }) =>
    ipcRenderer.invoke('save-conversation', payload),

  onWhisperProgress: (callback: (data: { status: string; message: string; progress: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('whisper-progress', handler)
    return () => ipcRenderer.removeListener('whisper-progress', handler)
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
