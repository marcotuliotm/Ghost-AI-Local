// Type definitions for the Ghost AI API exposed via preload
export interface GhostAPI {
  // Ollama
  ollamaChat: (payload: {
    model: string
    messages: OllamaMessage[]
    baseUrl: string
    options?: OllamaOptions
    // false turns off reasoning on thinking models (qwen3, etc.) for quick
    // utility calls; ignored by models without thinking support
    think?: boolean
  }) => Promise<{ success: boolean; message?: OllamaMessage; error?: string }>

  ollamaChatStream: (payload: {
    model: string
    messages: OllamaMessage[]
    baseUrl: string
    options?: OllamaOptions
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
  // `model` is a Hugging Face id from WHISPER_MODELS; a different id than the
  // loaded one unloads the current pipeline and loads the new one.
  whisperLoad: (model: string) => Promise<{ status: string; model?: string; error?: string }>
  // `language` is a TRANSCRIPTION_LANGUAGES id ('auto' = detect)
  whisperTranscribe: (audioBuffer: ArrayBuffer, language: string) => Promise<{ success: boolean; text?: string; error?: string }>
  whisperStatus: () => Promise<{ status: string; model?: string; error?: string }>
  onWhisperProgress: (callback: (data: { status: string; message: string; progress: number; model?: string }) => void) => () => void

  // Speaker embedding (diarization)
  embedLoad: () => Promise<{ status: string; error?: string }>
  embedSpeaker: (audioBuffer: ArrayBuffer) => Promise<{ success: boolean; embedding?: number[]; error?: string }>
  embedStatus: () => Promise<{ status: string; error?: string }>
  onEmbedProgress: (callback: (data: { status: string; message: string; progress: number }) => void) => () => void

  // Save conversation / transcript (.txt) or meeting notes (.md)
  saveConversation: (payload: { content: string; suggestedName: string; format?: SaveFormat }) =>
    Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>

  // Settings persistence (electron-store). `settings` is the raw stored object
  // (null on first run); the renderer merges it with DEFAULT_SETTINGS.
  settingsLoad: () => Promise<{ settings: unknown }>
  settingsSave: (settings: Settings) => Promise<{ success: boolean; error?: string }>

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

export type SaveFormat = 'txt' | 'md'

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
}

// Subset of Ollama's per-request runtime options that Ghost AI sets.
export interface OllamaOptions {
  num_ctx?: number // context window in tokens; Ollama's own default is small (2048-4096)
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
  kind?: 'notes' // assistant reply holding meeting notes (offers Save .md)
}

export interface QuickAction {
  label: string
  prompt: string
}

export interface Preset {
  id: string
  name: string
  systemPrompt: string
  suggestReplyPrompt: string // '{{transcript}}' is replaced with the excerpt to answer
  quickActions: QuickAction[]
}

export interface Settings {
  ollamaBaseUrl: string
  selectedModel: string
  opacity: number
  fontSize: number
  transcriptionInterval: number
  speakerThreshold: number // cosine-similarity threshold for speaker separation (0.5-0.95)
  contextLength: number // Ollama num_ctx (tokens) — also the budget for history + transcript
  whisperModel: string // Hugging Face id, one of WHISPER_MODELS
  transcriptionLanguage: string // 'auto' or a Whisper language name ('english', 'portuguese', ...)
  presets: Preset[] // prompt presets (built-ins first)
  activePresetId: string // supplies the system prompt, Suggest reply template and quick actions
}

declare global {
  interface Window {
    ghostAPI: GhostAPI
  }
}
