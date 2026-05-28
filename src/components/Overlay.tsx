import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatMessage, OllamaModel, Settings } from '../types'
import { ChatInput } from './ChatInput'
import { MessageBubble } from './MessageBubble'
import { AudioCapture } from './AudioCapture'

interface OverlayProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isConnected: boolean
  models: OllamaModel[]
  settings: Settings
  sendMessage: (content: string, screenshot?: string) => void
  askSuggestion: (context: string) => void
  analyzeScreenshot: () => void
  analyzeScreenshotCrop: () => void
  clearChat: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}

export function Overlay({
  messages,
  isStreaming,
  isConnected,
  settings,
  sendMessage,
  analyzeScreenshot,
  analyzeScreenshotCrop,
  clearChat,
  onOpenSettings,
  onOpenHelp,
}: OverlayProps) {
  const [isCompact, setIsCompact] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [currentTranscript, setCurrentTranscript] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on shortcut
  useEffect(() => {
    const removeFocusListener = window.ghostAPI.onFocusInput(() => {
      inputRef.current?.focus()
    })
    return () => removeFocusListener()
  }, [])

  // Handle screenshot event from global shortcut
  useEffect(() => {
    const removeScreenshotListener = window.ghostAPI.onScreenshotCaptured((dataUrl: string) => {
      // Use the already-captured screenshot directly, don't capture again
      sendMessage('Analyze this screenshot and tell me what is happening. Give suggestions if it is a conversation, code, or presentation.', dataUrl)
    })
    return () => removeScreenshotListener()
  }, [sendMessage])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.no-drag')) return
    const startX = e.screenX
    const startY = e.screenY

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.screenX - startX
      const deltaY = e.screenY - startY
      window.ghostAPI.moveWindow(deltaX, deltaY)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  // Save conversation to .txt file
  const handleSaveConversation = useCallback(async () => {
    if (messages.length === 0 || isSaving) return

    setIsSaving(true)
    try {
      // Format conversation as text
      const now = new Date()
      const dateStr = now.toISOString().slice(0, 10) // 2026-05-25
      const timeStr = now.toTimeString().slice(0, 5).replace(':', 'h') // 14h30

      const chatText = messages
        .filter(m => m.role !== 'system')
        .map(m => {
          const role = m.role === 'user' ? 'User' : 'Ghost AI'
          return `[${role}]\n${m.content}\n`
        })
        .join('\n---\n\n')

      const fullContent = `Ghost AI - Conversation Log\nDate: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${timeStr}\nModel: ${settings.selectedModel}\n\n${'='.repeat(50)}\n\n${chatText}`

      // Ask Ollama to generate a short filename from the conversation
      let suggestedName = `conversation_${dateStr}_${timeStr}`

      if (isConnected) {
        try {
          const summary = messages
            .filter(m => m.role !== 'system')
            .slice(0, 6)
            .map(m => m.content.slice(0, 100))
            .join(' ')

          const result = await window.ghostAPI.ollamaChat({
            model: settings.selectedModel,
            baseUrl: settings.ollamaBaseUrl,
            messages: [
              {
                role: 'system',
                content: 'Generate a very short filename (2-4 words, no spaces use underscores, lowercase, no extension, no special chars, english) that describes this conversation topic. Reply with ONLY the filename, nothing else.',
              },
              { role: 'user', content: summary },
            ],
          })

          if (result.success && result.message?.content) {
            const aiName = result.message.content
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, '_')
              .replace(/_+/g, '_')
              .replace(/^_|_$/g, '')
              .slice(0, 40)

            if (aiName.length > 2) {
              suggestedName = `${aiName}_${dateStr}`
            }
          }
        } catch {}
      }

      await window.ghostAPI.saveConversation({
        content: fullContent,
        suggestedName: `${suggestedName}.txt`,
      })
    } finally {
      setIsSaving(false)
    }
  }, [messages, settings, isConnected, isSaving])

  return (
    <div className="w-full h-full flex flex-col glass rounded-2xl overflow-hidden animate-fade-in">
      {/* Title Bar */}
      <div
        className="drag-region flex items-center justify-between px-3 py-2 border-b border-ghost-border"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-ghost-success' : 'bg-ghost-error'} animate-pulse-dot`} />
          <span className="text-[10px] text-ghost-text-muted font-medium tracking-wider uppercase">
            Ghost AI
          </span>
          {isConnected && (
            <span className="text-[9px] text-ghost-text-muted opacity-60">
              {settings.selectedModel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 no-drag">
          {/* Compact toggle */}
          <button
            onClick={() => setIsCompact(!isCompact)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title={isCompact ? 'Expand' : 'Compact'}
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isCompact ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              )}
            </svg>
          </button>

          {/* Screenshot full */}
          <button
            onClick={analyzeScreenshot}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Capture full screen (Cmd+Shift+S)"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Screenshot crop */}
          <button
            onClick={analyzeScreenshotCrop}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Capture screen region (Cmd+Shift+X)"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3v4M3 7h4m10 0h4M17 3v4M7 17v4M3 17h4m10 0h4m-4-14v14H7V3" />
            </svg>
          </button>

          {/* Save conversation */}
          <button
            onClick={handleSaveConversation}
            disabled={messages.length === 0 || isSaving}
            className="p-1 rounded hover:bg-white/10 transition-colors disabled:opacity-30"
            title="Save conversation to .txt"
          >
            {isSaving ? (
              <svg className="w-3 h-3 text-ghost-accent animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
            )}
          </button>

          {/* Clear chat */}
          <button
            onClick={clearChat}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Clear chat"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Help */}
          <button
            onClick={onOpenHelp}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Help - Shortcuts & buttons"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Minimize */}
          <button
            onClick={() => window.ghostAPI.minimizeWindow()}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Hide (Cmd+Shift+G)"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>

          {/* Close / Quit */}
          <button
            onClick={() => window.ghostAPI.closeWindow()}
            className="p-1 rounded hover:bg-red-500/60 transition-colors"
            title="Quit"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      {!isCompact && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="text-2xl mb-3 opacity-40">👻</div>
              <p className="text-xs text-ghost-text-muted mb-1">
                Ghost AI - Local Anonymous Assistant
              </p>
              <p className="text-[10px] text-ghost-text-muted opacity-60 mb-3">
                Everything runs locally via Ollama. No data leaves your machine.
              </p>
              {!isConnected && (
                <div className="bg-ghost-error/20 text-ghost-error rounded-lg px-3 py-2 text-[10px]">
                  Ollama not detected. Start Ollama first.
                  <br />
                  <code className="text-[9px] opacity-80">ollama serve</code>
                </div>
              )}
              <div className="mt-3 space-y-1.5 text-[9px] text-ghost-text-muted opacity-50 w-full max-w-[220px]">
                <div className="flex justify-between">
                  <span>Show/Hide overlay</span>
                  <kbd className="bg-white/10 px-1 py-0.5 rounded font-mono text-[8px]">Cmd+Shift+G</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Capture screenshot</span>
                  <kbd className="bg-white/10 px-1 py-0.5 rounded font-mono text-[8px]">Cmd+Shift+S</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Focus input</span>
                  <kbd className="bg-white/10 px-1 py-0.5 rounded font-mono text-[8px]">Cmd+Shift+A</kbd>
                </div>
              </div>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Quick Actions */}
      {!isCompact && messages.length > 0 && !isStreaming && (
        <div className="px-3 py-1 flex gap-1 overflow-x-auto no-drag">
          <QuickAction
            label="Summarize"
            onClick={() => sendMessage('Summarize the conversation so far in key points.')}
          />
          <QuickAction
            label="Suggest reply"
            onClick={() => sendMessage('Based on the context, suggest what I should respond now.')}
          />
          <QuickAction
            label="Next steps"
            onClick={() => sendMessage('What are the logical next steps?')}
          />
        </div>
      )}

      {/* Audio Capture */}
      {!isCompact && (
        <div className="px-3 py-1.5 border-t border-ghost-border no-drag">
          <AudioCapture
            onTranscription={(text) => {
              const prompt = (settings.suggestReplyPrompt || 'The other person said: "{{transcript}}"\n\nSuggest a short, natural response to continue this conversation.')
                .replace('{{transcript}}', text)
              sendMessage(prompt)
            }}
            onSummarize={(text) => {
              sendMessage(`Summarize the following conversation/audio transcription into clear bullet points with the key topics discussed:\n\n"${text}"`)
            }}
            onTranslate={(text) => {
              sendMessage(`Translate the following text to Brazilian Portuguese. Provide ONLY the translation, nothing else:\n\n"${text}"`)
            }}
            onTranscriptChange={setCurrentTranscript}
            isConnected={isConnected}
            settings={settings}
          />
        </div>
      )}

      {/* Input */}
      <ChatInput
        ref={inputRef}
        onSend={(content) => {
          // If there's an active transcription, include it as context
          if (currentTranscript.trim()) {
            const contextMessage = `[Audio transcription context]\n"${currentTranscript.trim()}"\n\n[User question]\n${content}`
            sendMessage(contextMessage)
          } else {
            sendMessage(content)
          }
        }}
        isStreaming={isStreaming}
        isConnected={isConnected}
        isCompact={isCompact}
      />
    </div>
  )
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 px-2 py-0.5 rounded-full text-[9px] bg-ghost-accent/20 text-ghost-accent hover:bg-ghost-accent/30 transition-colors no-drag"
    >
      {label}
    </button>
  )
}
