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
  language: 'pt-BR',
  transcriptionInterval: 10,
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
      content: screenshot ? `[Screenshot anexado]\n\n${content}` : content,
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

        // Include screenshot as base64 image for Ollama vision API
        if (msg.screenshot) {
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
          lastMsg.content = `Erro: ${result.error}\n\nVerifique se o Ollama esta rodando em ${settings.ollamaBaseUrl}`
          lastMsg.isStreaming = false
        }
        return updated
      })
      setIsStreaming(false)
    }
  }, [settings, isStreaming])

  // Quick actions
  const askSuggestion = useCallback((context: string) => {
    sendMessage(`Com base no seguinte contexto, me de uma sugestao de resposta curta e natural:\n\n"${context}"`)
  }, [sendMessage])

  const analyzeScreenshot = useCallback(async () => {
    const screenshot = await window.ghostAPI.captureScreenshot()
    if (screenshot) {
      sendMessage('Analise este screenshot e me diga o que esta acontecendo. De sugestoes se for uma conversa, codigo, ou apresentacao.', screenshot)
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
