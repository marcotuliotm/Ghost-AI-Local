// Type definitions for the Ghost AI API exposed via preload
export interface GhostAPI {
  // Ollama
  ollamaChat: (payload: {
    model: string
    messages: OllamaMessage[]
    baseUrl: string
  }) => Promise<{ success: boolean; message?: OllamaMessage; error?: string }>

  ollamaChatStream: (payload: {
    model: string
    messages: OllamaMessage[]
    baseUrl: string
  }) => Promise<{ success: boolean; message?: OllamaMessage; error?: string }>

  ollamaListModels: (baseUrl: string) => Promise<{
    success: boolean
    models: OllamaModel[]
    error?: string
  }>

  ollamaCheck: (baseUrl: string) => Promise<{ connected: boolean }>

  // Screenshot
  captureScreenshot: () => Promise<string | null>
  captureScreenshotCrop: () => Promise<string | null>

  // Window
  minimizeWindow: () => void
  closeWindow: () => void
  setIgnoreMouse: (ignore: boolean) => void
  moveWindow: (x: number, y: number) => void
  resizeWindow: (width: number, height: number) => void
  setOpacity: (opacity: number) => void

  // Microphone
  requestMicPermission: () => Promise<{ granted: boolean }>
  getMicStatus: () => Promise<{ status: string }>

  // Whisper (local transcription)
  whisperLoad: () => Promise<{ status: string; error?: string }>
  whisperTranscribe: (audioBuffer: ArrayBuffer) => Promise<{ success: boolean; text?: string; error?: string }>
  whisperStatus: () => Promise<{ status: string; error?: string }>
  onWhisperProgress: (callback: (data: { status: string; message: string; progress: number }) => void) => () => void

  // Save conversation
  saveConversation: (payload: { content: string; suggestedName: string }) =>
    Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>

  // Clipboard
  copyText: (text: string) => Promise<boolean>

  // Events
  onStreamChunk: (callback: (chunk: string) => void) => () => void
  onStreamDone: (callback: (fullResponse: string) => void) => () => void
  onScreenshotCaptured: (callback: (dataUrl: string) => void) => () => void
  onFocusInput: (callback: () => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
  onOverlayVisibility: (callback: (visible: boolean) => void) => () => void
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
}

export interface OllamaModel {
  name: string
  size: number
  digest: string
  modified_at: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  isStreaming?: boolean
  screenshot?: string
}

export interface Settings {
  ollamaBaseUrl: string
  selectedModel: string
  systemPrompt: string
  suggestReplyPrompt: string
  opacity: number
  fontSize: number
  language: string
  transcriptionInterval: number
}

declare global {
  interface Window {
    ghostAPI: GhostAPI
  }
}
