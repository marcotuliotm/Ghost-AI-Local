import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage, OllamaMessage, OllamaModel, Settings } from '../types'
import { estimateMessageTokens, fitHistoryToBudget, promptBudget, transcriptSystemMessage } from '../lib/context'
import { DEFAULT_PRESET_ID, defaultPresets, getActivePreset } from '../lib/presets'
import { mergeSettings } from '../lib/settings'
import { DEFAULT_TRANSCRIPTION_LANGUAGE, DEFAULT_WHISPER_MODEL } from '../lib/whisper'

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
}

export function useGhostAI() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  // False until the settings saved on disk have been read. Nothing is written
  // back before that, so the defaults never overwrite the stored settings.
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [currentStreamContent, setCurrentStreamContent] = useState('')
  const streamContentRef = useRef('')
  const messagesRef = useRef<ChatMessage[]>([])

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

  // Check Ollama connection
  const checkConnection = useCallback(async () => {
    const result = await window.ghostAPI.ollamaCheck(settings.ollamaBaseUrl)
    setIsConnected(result.connected)
    return result.connected
  }, [settings.ollamaBaseUrl])

  // Fetch available models
  const fetchModels = useCallback(async () => {
    const result = await window.ghostAPI.ollamaListModels(settings.ollamaBaseUrl)
    if (result.success) {
      setModels(result.models)
      // Auto-select first model if current selection is not available. Wait
      // for the stored settings: until then selectedModel is just the default.
      if (settingsLoaded && result.models.length > 0 && !result.models.find(m => m.name === settings.selectedModel)) {
        setSettings(prev => ({ ...prev, selectedModel: result.models[0].name }))
      }
    }
    return result.models
  }, [settings.ollamaBaseUrl, settings.selectedModel, settingsLoaded])

  // Initialize connection check
  useEffect(() => {
    checkConnection().then(connected => {
      if (connected) fetchModels()
    })

    const interval = setInterval(() => {
      checkConnection().then(connected => {
        if (connected) fetchModels()
      })
    }, 10000)

    return () => clearInterval(interval)
  }, [checkConnection, fetchModels])

  // Set up stream event listeners
  useEffect(() => {
    const removeChunkListener = window.ghostAPI.onStreamChunk((chunk: string) => {
      streamContentRef.current += chunk
      setCurrentStreamContent(streamContentRef.current)
    })

    const removeDoneListener = window.ghostAPI.onStreamDone((fullResponse: string) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.isStreaming) return prev
        return [...prev.slice(0, -1), { ...lastMsg, content: fullResponse, isStreaming: false }]
      })
      setIsStreaming(false)
      setCurrentStreamContent('')
      streamContentRef.current = ''
    })

    return () => {
      removeChunkListener()
      removeDoneListener()
    }
  }, [])

  // Update streaming message content
  useEffect(() => {
    if (isStreaming && currentStreamContent) {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.isStreaming) return prev
        return [...prev.slice(0, -1), { ...lastMsg, content: currentStreamContent }]
      })
    }
  }, [currentStreamContent, isStreaming])

  // Keep messagesRef in sync so sendMessage always has latest messages
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Send message
  const sendMessage = useCallback(async (content: string, screenshot?: string, options?: SendMessageOptions) => {
    if (!content.trim() && !screenshot) return
    if (isStreaming) return

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

    // Read current messages from ref (always up-to-date, no stale closure)
    const currentMessages = messagesRef.current
    setMessages(prev => [...prev, userMessage, assistantMessage])
    setIsStreaming(true)
    streamContentRef.current = ''
    setCurrentStreamContent('')

    // System prompt + transcript context go first; the chat history gets
    // whatever budget is left, newest messages first.
    const systemPrompt = options?.systemPrompt ?? getActivePreset(settings).systemPrompt
    const systemMessages: OllamaMessage[] = [{ role: 'system', content: systemPrompt }]
    const transcriptMsg = transcriptSystemMessage(options?.context ?? '')
    if (transcriptMsg) systemMessages.push(transcriptMsg)

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
    const historyBudget = promptBudget(settings.contextLength) - systemTokens
    const ollamaMessages = [...systemMessages, ...fitHistoryToBudget(history, historyBudget)]

    // Use streaming
    const result = await window.ghostAPI.ollamaChatStream({
      model: settings.selectedModel,
      messages: ollamaMessages,
      baseUrl: settings.ollamaBaseUrl,
      options: { num_ctx: settings.contextLength },
    })

    if (!result.success) {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1]
        if (!lastMsg || lastMsg.role !== 'assistant') return prev
        const err = result.error || 'Unknown error'
        // Only blame connectivity for actual connection failures. A 4xx from
        // Ollama means it IS reachable but rejected the request (bad model,
        // context too large, etc.) — show that reason instead of "is it running?".
        const isConnectionIssue = /failed to fetch|fetch failed|econnrefused|connection refused|enotfound|network|timed out|timeout|not loaded/i.test(err)
        const content = isConnectionIssue
          ? `Error: ${err}\n\nIs Ollama running at ${settings.ollamaBaseUrl}? Start it with \`ollama serve\`.`
          : `Error: ${err}`
        return [...prev.slice(0, -1), { ...lastMsg, content, isStreaming: false }]
      })
      setIsStreaming(false)
    }
  }, [settings, isStreaming])

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

  const clearChat = useCallback(() => {
    setMessages([])
  }, [])

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }, [])

  return {
    messages,
    isStreaming,
    isConnected,
    models,
    settings,
    settingsLoaded,
    sendMessage,
    askSuggestion,
    analyzeScreenshot,
    analyzeScreenshotCrop,
    clearChat,
    updateSettings,
    checkConnection,
    fetchModels,
  }
}
