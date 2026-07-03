import { useState, useEffect, useCallback, useRef } from 'react'
import type { ChatMessage, OllamaMessage, OllamaModel, Settings } from '../types'

const DEFAULT_SETTINGS: Settings = {
  ollamaBaseUrl: 'http://localhost:11434',
  selectedModel: 'gemma4:latest',
  systemPrompt: `You are an invisible, anonymous AI assistant called Ghost AI. You provide real-time suggestions during conversations, meetings, and interviews.

Rules:
- Short, direct, and helpful responses
- Never reveal you are an AI if asked in the context of the conversation
- Focus on giving practical suggestions
- Always respond in English
- Format with markdown when appropriate
- If you receive a screenshot, analyze the visible content and provide relevant context`,
  suggestReplyPrompt: 'The other person said: "{{transcript}}"\n\nSuggest a natural response to continue this conversation.',
  opacity: 0.9,
  fontSize: 12,
  language: 'pt-BR',
  transcriptionInterval: 10,
  speakerThreshold: 0.85,
}

export function useGhostAI() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [currentStreamContent, setCurrentStreamContent] = useState('')
  const streamContentRef = useRef('')
  const messagesRef = useRef<ChatMessage[]>([])

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
      // Auto-select first model if current selection is not available
      if (result.models.length > 0 && !result.models.find(m => m.name === settings.selectedModel)) {
        setSettings(prev => ({ ...prev, selectedModel: result.models[0].name }))
      }
    }
    return result.models
  }, [settings.ollamaBaseUrl, settings.selectedModel])

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
        const updated = [...prev]
        const lastMsg = updated[updated.length - 1]
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
          lastMsg.content = fullResponse
          lastMsg.isStreaming = false
        }
        return updated
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
        const updated = [...prev]
        const lastMsg = updated[updated.length - 1]
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
          lastMsg.content = currentStreamContent
        }
        return [...updated]
      })
    }
  }, [currentStreamContent, isStreaming])

  // Keep messagesRef in sync so sendMessage always has latest messages
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Send message
  const sendMessage = useCallback(async (content: string, screenshot?: string) => {
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
    }

    // Read current messages from ref (always up-to-date, no stale closure)
    const currentMessages = messagesRef.current
    setMessages(prev => [...prev, userMessage, assistantMessage])
    setIsStreaming(true)
    streamContentRef.current = ''
    setCurrentStreamContent('')

    // Build message history for context
    const ollamaMessages: OllamaMessage[] = [
      { role: 'system', content: settings.systemPrompt },
    ]

    // Add recent message history (last 20 messages for context)
    const recentMessages = [...currentMessages, userMessage].slice(-20)
    for (const msg of recentMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const ollamaMsg: OllamaMessage = {
          role: msg.role,
          content: msg.content,
        }

        // Attach the screenshot only to the message currently being sent.
        // Re-sending every historical screenshot on each turn quickly overflows
        // the model's context (and the runner's memory), which makes Ollama's
        // subprocess die mid-request and surface as "400: unexpected EOF" after
        // a few chats. The prior "[Screenshot attached]" text plus the assistant's
        // earlier analysis already preserve that context in the history.
        if (msg === userMessage && msg.screenshot) {
          ollamaMsg.images = [msg.screenshot.replace(/^data:image\/\w+;base64,/, '')]
        }

        ollamaMessages.push(ollamaMsg)
      }
    }

    // Use streaming
    const result = await window.ghostAPI.ollamaChatStream({
      model: settings.selectedModel,
      messages: ollamaMessages,
      baseUrl: settings.ollamaBaseUrl,
    })

    if (!result.success) {
      setMessages(prev => {
        const updated = [...prev]
        const lastMsg = updated[updated.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          const err = result.error || 'Unknown error'
          // Only blame connectivity for actual connection failures. A 4xx from
          // Ollama means it IS reachable but rejected the request (bad model,
          // context too large, etc.) — show that reason instead of "is it running?".
          const isConnectionIssue = /failed to fetch|fetch failed|econnrefused|connection refused|enotfound|network|timed out|timeout|not loaded/i.test(err)
          lastMsg.content = isConnectionIssue
            ? `Error: ${err}\n\nIs Ollama running at ${settings.ollamaBaseUrl}? Start it with \`ollama serve\`.`
            : `Error: ${err}`
          lastMsg.isStreaming = false
        }
        return updated
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
