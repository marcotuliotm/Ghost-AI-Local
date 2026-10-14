import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage, OllamaMessage, OllamaModel, Settings, StreamResult } from '../types'
import { estimateMessageTokens, fitHistoryToBudget, promptBudget, transcriptSystemMessage, transcriptTail, type ContextUsage } from '../lib/context'
import { DEFAULT_EMBEDDING_MODEL, DOCUMENTS_SHARE, documentsSystemMessage, fitChunks, uniqueSources } from '../lib/rag'
import { DEFAULT_PRESET_ID, defaultPresets, getActivePreset } from '../lib/presets'
import { mergeSettings } from '../lib/settings'
import { DEFAULT_TRANSCRIPTION_LANGUAGE, DEFAULT_WHISPER_MODEL } from '../lib/whisper'
import { DEFAULT_SHORTCUTS, type ShortcutAction } from '../lib/shortcuts'

export interface SendMessageOptions {
  // Live transcript context, sent as a system message on this request only —
  // never stored in the chat history, so it doesn't pile up turn after turn.
  context?: string
  // Replaces the active preset's system prompt for this request only.
  systemPrompt?: string
  // Leave the chat history out of the request (e.g. meeting notes, which
  // should come from the transcript alone).
  standalone?: boolean
  // Tag for the assistant reply (e.g. 'notes' offers Save .md)
  kind?: ChatMessage['kind']
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaBaseUrl: 'http://localhost:11434',
  selectedModel: 'gemma4:latest',
  opacity: 0.9,
  fontSize: 12,
  transcriptionInterval: 10,
  speakerThreshold: 0.85,
  contextLength: 8192,
  whisperModel: DEFAULT_WHISPER_MODEL,
  transcriptionLanguage: DEFAULT_TRANSCRIPTION_LANGUAGE,
  presets: defaultPresets(),
  activePresetId: DEFAULT_PRESET_ID,
  reasoning: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  hideFromScreenShare: true,
  onboardingCompleted: false,
  embeddingModel: DEFAULT_EMBEDDING_MODEL,
}

// Requests made while a reply is streaming wait here (screenshot shortcut,
// notes, Summarize...). Beyond this many, the oldest waiting one is dropped.
export const MAX_QUEUED_REQUESTS = 3

interface QueuedRequest {
  content: string
  screenshot?: string
  options?: SendMessageOptions
}

// The reply currently streaming. Chunks for any other requestId are ignored.
interface ActiveRequest {
  requestId: string
  assistantId: string
  content: string
  thinking: string
}

const CONNECTION_ERROR = /failed to fetch|fetch failed|econnrefused|connection refused|enotfound|network|timed out|timeout|not loaded/i

export function useGhostAI() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  // Why Ollama can't be used (e.g. a non-local URL); null when fine
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [models, setModels] = useState<OllamaModel[]>([])
  // Local embedding models (for document retrieval), by name
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  // False until the settings saved on disk have been read. Nothing is written
  // back before that, so the defaults never overwrite the stored settings.
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [queue, setQueue] = useState<QueuedRequest[]>([])
  // Prompt size of the last request, for the title-bar context indicator
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  // Shortcuts the main process could not register (taken by another app)
  const [shortcutErrors, setShortcutErrors] = useState<ShortcutAction[]>([])
  const activeRef = useRef<ActiveRequest | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  // Read at request time, so queued requests use the settings of that moment
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Load persisted settings once, merged over the defaults
  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => window.ghostAPI.settingsLoad())
      .then(res => {
        if (!cancelled) setSettings(mergeSettings(DEFAULT_SETTINGS, res?.settings))
      })
      .catch(err => console.error('Failed to load settings:', err))
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  // Persist every change once loaded
  useEffect(() => {
    if (!settingsLoaded) return
    Promise.resolve()
      .then(() => window.ghostAPI.settingsSave(settings))
      .catch(err => console.error('Failed to save settings:', err))
  }, [settings, settingsLoaded])

  // Register the configured global shortcuts once the stored ones are known
  useEffect(() => {
    if (!settingsLoaded) return
    let cancelled = false
    Promise.resolve()
      .then(() => window.ghostAPI.shortcutsUpdate(settings.shortcuts))
      .then(res => { if (!cancelled) setShortcutErrors(res?.failed ?? []) })
      .catch(err => console.error('Failed to register shortcuts:', err))
    return () => { cancelled = true }
  }, [settings.shortcuts, settingsLoaded])

  // Connection + model list in one request
  const refreshStatus = useCallback(async () => {
    const result = await window.ghostAPI.ollamaStatus(settings.ollamaBaseUrl)
    setIsConnected(result.connected)
    setConnectionError(result.error ?? null)
    if (result.connected) {
      setModels(result.models)
      setEmbeddingModels(result.embeddingModels ?? [])
      // Auto-select first model if current selection is not available. Wait
      // for the stored settings: until then selectedModel is just the default.
      if (settingsLoaded && result.models.length > 0 && !result.models.find(m => m.name === settings.selectedModel)) {
        setSettings(prev => ({ ...prev, selectedModel: result.models[0].name }))
      }
    }
    return result
  }, [settings.ollamaBaseUrl, settings.selectedModel, settingsLoaded])

  const checkConnection = useCallback(async () => (await refreshStatus()).connected, [refreshStatus])
  const fetchModels = useCallback(async () => (await refreshStatus()).models, [refreshStatus])

  useEffect(() => {
    refreshStatus()
    const interval = setInterval(refreshStatus, 10000)
    return () => clearInterval(interval)
  }, [refreshStatus])

  const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)))
  }, [])

  // Stream chunks, matched to the active request by id
  useEffect(() => {
    return window.ghostAPI.onStreamChunk(chunk => {
      const active = activeRef.current
      if (!active || chunk.requestId !== active.requestId) return
      active.content += chunk.content
      active.thinking += chunk.thinking
      updateMessage(active.assistantId, {
        content: active.content,
        ...(active.thinking ? { thinking: active.thinking } : {}),
      })
    })
  }, [updateMessage])

  // Keep messagesRef in sync so requests always see the latest history
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Start one streaming request. Callers make sure nothing else is streaming.
  const startRequest = useCallback(async ({ content, screenshot, options }: QueuedRequest) => {
    const current = settingsRef.current
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: screenshot ? `[Screenshot attached]\n\n${content}` : content,
      timestamp: Date.now(),
      screenshot,
    }
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      ...(options?.kind ? { kind: options.kind } : {}),
    }
    const active: ActiveRequest = { requestId: crypto.randomUUID(), assistantId: assistantMessage.id, content: '', thinking: '' }
    activeRef.current = active

    // Read current messages from ref (always up-to-date, no stale closure)
    const currentMessages = messagesRef.current
    setMessages(prev => [...prev, userMessage, assistantMessage])
    setIsStreaming(true)

    // System prompt + transcript context go first; the chat history gets
    // whatever budget is left, newest messages first.
    const systemPrompt = options?.systemPrompt ?? getActivePreset(current).systemPrompt
    const systemMessages: OllamaMessage[] = [{ role: 'system', content: systemPrompt }]
    const transcriptMsg = transcriptSystemMessage(options?.context ?? '')
    if (transcriptMsg) systemMessages.push(transcriptMsg)

    // Excerpts from the user's documents relevant to this request (none when
    // no document is enabled). Meeting notes (standalone) stick to the transcript.
    const budget = promptBudget(current.contextLength)
    let sources: string[] = []
    if (!options?.standalone) {
      try {
        const query = [content, transcriptTail(options?.context ?? '', 150)].filter(Boolean).join('\n')
        const maxTokens = Math.floor(budget * DOCUMENTS_SHARE)
        const { chunks } = await window.ghostAPI.docsSearch({
          query, baseUrl: current.ollamaBaseUrl, embeddingModel: current.embeddingModel, maxTokens,
        })
        const fitted = fitChunks(chunks ?? [], maxTokens)
        if (fitted.length > 0) {
          systemMessages.push({ role: 'system', content: documentsSystemMessage(fitted) })
          sources = uniqueSources(fitted)
          updateMessage(assistantMessage.id, { sources })
        }
      } catch (err) {
        console.warn('Document search failed:', err)
      }
    }

    const history: OllamaMessage[] = []
    for (const msg of options?.standalone ? [userMessage] : [...currentMessages, userMessage]) {
      if (msg.role !== 'user' && msg.role !== 'assistant') continue
      const ollamaMsg: OllamaMessage = { role: msg.role, content: msg.content }

      // Attach the screenshot only to the message currently being sent.
      // Re-sending every historical screenshot on each turn quickly overflows
      // the model's context (and the runner's memory), which makes Ollama's
      // subprocess die mid-request and surface as "400: unexpected EOF" after
      // a few chats. The prior "[Screenshot attached]" text plus the assistant's
      // earlier analysis already preserve that context in the history.
      if (msg === userMessage && msg.screenshot) {
        ollamaMsg.images = [msg.screenshot.replace(/^data:image\/\w+;base64,/, '')]
      }
      history.push(ollamaMsg)
    }

    const systemTokens = systemMessages.reduce((n, m) => n + estimateMessageTokens(m), 0)
    const fittedHistory = fitHistoryToBudget(history, budget - systemTokens)
    const ollamaMessages = [...systemMessages, ...fittedHistory]
    setContextUsage({
      promptTokens: ollamaMessages.reduce((n, m) => n + estimateMessageTokens(m), 0),
      budget,
      contextLength: current.contextLength,
      droppedMessages: history.length - fittedHistory.length,
    })

    let result: StreamResult
    try {
      result = await window.ghostAPI.ollamaChatStream({
        requestId: active.requestId,
        model: current.selectedModel,
        messages: ollamaMessages,
        baseUrl: current.ollamaBaseUrl,
        options: { num_ctx: current.contextLength },
        ...(current.reasoning ? {} : { think: false }),
      })
    } catch (err: any) {
      result = { success: false, error: err?.message || String(err) }
    }

    const text = result.content ?? active.content
    const thinking = (result.thinking ?? active.thinking) || undefined
    if (result.success) {
      updateMessage(active.assistantId, {
        content: text,
        thinking,
        isStreaming: false,
        ...(result.aborted ? { stopped: true } : {}),
      })
    } else {
      const err = result.error || 'Unknown error'
      // Only blame connectivity for actual connection failures. A 4xx from
      // Ollama means it IS reachable but rejected the request (bad model,
      // context too large, etc.) — show that reason instead of "is it running?".
      const message = CONNECTION_ERROR.test(err)
        ? `Error: ${err}\n\nIs Ollama running at ${current.ollamaBaseUrl}? Start it with \`ollama serve\`.`
        : `Error: ${err}`
      updateMessage(active.assistantId, {
        content: text ? `${text}\n\n${message}` : message,
        thinking,
        isStreaming: false,
      })
    }
    if (activeRef.current === active) activeRef.current = null
    setIsStreaming(false)
  }, [updateMessage])

  // Send now, or queue it if a reply is still streaming
  const sendMessage = useCallback(async (content: string, screenshot?: string, options?: SendMessageOptions) => {
    if (!content.trim() && !screenshot) return
    if (activeRef.current) {
      setQueue(prev => [...prev, { content, screenshot, options }].slice(-MAX_QUEUED_REQUESTS))
      return
    }
    await startRequest({ content, screenshot, options })
  }, [startRequest])

  // Run the next queued request once the current reply is done
  useEffect(() => {
    if (isStreaming || activeRef.current || queue.length === 0) return
    const [next, ...rest] = queue
    setQueue(rest)
    startRequest(next)
  }, [isStreaming, queue, startRequest])

  // Stop the reply that is streaming; queued requests still run
  const stopGeneration = useCallback(() => {
    const active = activeRef.current
    if (active) window.ghostAPI.ollamaAbort(active.requestId)
  }, [])

  // Quick actions
  const askSuggestion = useCallback((context: string) => {
    sendMessage(`Based on the following context, suggest a short, natural response:\n\n"${context}"`)
  }, [sendMessage])

  const analyzeScreenshot = useCallback(async () => {
    const screenshot = await window.ghostAPI.captureScreenshot()
    if (screenshot) {
      sendMessage('Analyze this screenshot and tell me what is happening. Give suggestions if it is a conversation, code, or presentation.', screenshot)
    }
  }, [sendMessage])

  const analyzeScreenshotCrop = useCallback(async () => {
    const screenshot = await window.ghostAPI.captureScreenshotCrop()
    if (screenshot) {
      sendMessage('Analyze this cropped screenshot region and describe what you see. Give suggestions if it is a conversation, code, or presentation.', screenshot)
    }
  }, [sendMessage])

  // Clearing also drops waiting requests and stops the one in progress
  const clearChat = useCallback(() => {
    setQueue([])
    stopGeneration()
    setMessages([])
  }, [stopGeneration])

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }, [])

  return {
    messages,
    isStreaming,
    queuedCount: queue.length,
    contextUsage,
    isConnected,
    connectionError,
    models,
    embeddingModels,
    settings,
    settingsLoaded,
    shortcutErrors,
    sendMessage,
    stopGeneration,
    askSuggestion,
    analyzeScreenshot,
    analyzeScreenshotCrop,
    clearChat,
    updateSettings,
    checkConnection,
    fetchModels,
  }
}
