import { useState, useRef, useEffect, useCallback, type RefObject } from 'react'
import type { ChatMessage, OllamaModel, Settings } from '../types'
import { ChatInput } from './ChatInput'
import { MessageBubble } from './MessageBubble'
import { AudioCapture } from './AudioCapture'
import { useTranscriptContext } from '../hooks/useTranscriptContext'
import type { SendMessageOptions } from '../hooks/useGhostAI'
import { fillSuggestReplyPrompt, getActivePreset } from '../lib/presets'
import { buildMeetingNotesRequest, normalizeNotesMarkdown, notesDocument, notesLanguage } from '../lib/notes'
import { fileStamp, suggestFilename } from '../lib/filename'
import { DEFAULT_SHORTCUTS, formatAccelerator, isMacPlatform, type ShortcutAction } from '../lib/shortcuts'

// Close a dropdown when clicking outside of it
function useClickOutside(ref: RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [ref, open, close])
}

interface OverlayProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isConnected: boolean
  models: OllamaModel[]
  settings: Settings
  settingsLoaded?: boolean
  connectionError?: string | null
  queuedCount?: number
  stopGeneration?: () => void
  sendMessage: (content: string, screenshot?: string, options?: SendMessageOptions) => void
  askSuggestion: (context: string) => void
  analyzeScreenshot: () => void
  analyzeScreenshotCrop: () => void
  clearChat: () => void
  updateSettings: (settings: Partial<Settings>) => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}

export function Overlay({
  messages,
  isStreaming,
  isConnected,
  models,
  settings,
  settingsLoaded = true,
  connectionError = null,
  queuedCount = 0,
  stopGeneration,
  sendMessage,
  analyzeScreenshot,
  analyzeScreenshotCrop,
  clearChat,
  updateSettings,
  onOpenSettings,
  onOpenHelp,
}: OverlayProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showPresetMenu, setShowPresetMenu] = useState(false)
  const [currentTranscript, setCurrentTranscript] = useState('')
  // Speakers in the transcript as displayed (custom names applied): notes owners
  const [transcriptSpeakers, setTranscriptSpeakers] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const presetMenuRef = useRef<HTMLDivElement>(null)
  // Transcript context (running summary + recent verbatim), built per request
  const { getContext: getTranscriptContext } = useTranscriptContext(currentTranscript, settings, isConnected)
  // Supplies the Suggest reply template and the quick actions (useGhostAI uses its system prompt)
  const activePreset = getActivePreset(settings)
  // Labels for the configured global shortcuts ("Cmd+Shift+S")
  const isMac = isMacPlatform()
  const keys = (action: ShortcutAction) =>
    formatAccelerator(settings.shortcuts?.[action] ?? DEFAULT_SHORTCUTS[action], isMac)

  const closeModelMenu = useCallback(() => setShowModelMenu(false), [])
  const closePresetMenu = useCallback(() => setShowPresetMenu(false), [])
  useClickOutside(modelMenuRef, showModelMenu, closeModelMenu)
  useClickOutside(presetMenuRef, showPresetMenu, closePresetMenu)

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

  // Save conversation to .txt file
  const handleSaveConversation = useCallback(async () => {
    if (messages.length === 0 || isSaving) return

    setIsSaving(true)
    try {
      // Format conversation as text
      const now = new Date()
      const { date: dateStr, time: timeStr } = fileStamp(now)

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
        const summary = messages
          .filter(m => m.role !== 'system')
          .slice(0, 6)
          .map(m => m.content.slice(0, 100))
          .join(' ')
        const aiName = await suggestFilename(settings, summary, 'conversation')
        if (aiName) suggestedName = `${aiName}_${dateStr}`
      }

      await window.ghostAPI.saveConversation({
        content: fullContent,
        suggestedName: `${suggestedName}.txt`,
        format: 'txt',
      })
    } finally {
      setIsSaving(false)
    }
  }, [messages, settings, isConnected, isSaving])

  const handleTranscriptChange = useCallback((text: string, speakers: string[] = []) => {
    setCurrentTranscript(text)
    setTranscriptSpeakers(prev => (prev.join('\u0000') === speakers.join('\u0000') ? prev : speakers))
  }, [])

  // Meeting notes from the transcript context (summary + recent verbatim),
  // trimmed to the prompt budget, written in the conversation's language.
  // Sent without chat history; the reply is tagged so its bubble offers Save .md.
  const handleGenerateNotes = useCallback(() => {
    const language = notesLanguage(settings.whisperModel, settings.transcriptionLanguage)
    const request = buildMeetingNotesRequest(getTranscriptContext(), settings.contextLength, language, transcriptSpeakers)
    if (!request.context) return
    sendMessage(request.prompt, undefined, {
      context: request.context,
      systemPrompt: request.systemPrompt,
      standalone: true,
      kind: 'notes',
    })
  }, [getTranscriptContext, settings.contextLength, settings.whisperModel, settings.transcriptionLanguage, transcriptSpeakers, sendMessage])

  const handleSaveNotes = useCallback(async (markdown: string) => {
    const now = new Date()
    const { date, time } = fileStamp(now)
    let suggestedName = `meeting_notes_${date}_${time}`
    if (isConnected) {
      const aiName = await suggestFilename(settings, normalizeNotesMarkdown(markdown).slice(0, 500), 'meeting')
      if (aiName) suggestedName = `notes_${aiName}_${date}`
    }
    await window.ghostAPI.saveConversation({
      content: notesDocument(markdown, { date: now, model: settings.selectedModel, preset: activePreset.name }),
      suggestedName: `${suggestedName}.md`,
      format: 'md',
    })
  }, [isConnected, settings, activePreset.name])

  return (
    <div className="w-full h-full flex flex-col glass rounded-xl overflow-hidden animate-fade-in">
      {/* Title Bar — pl clears the native macOS traffic-light buttons (top-left) */}
      <div
        className="drag-region flex items-center justify-between pl-[78px] pr-3 h-11 border-b border-ghost-border"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-ghost-success' : 'bg-ghost-error'} animate-pulse-dot`} />
          <span className="text-xs font-semibold text-ghost-text">
            Ghost AI
          </span>
          {isConnected && (
            <span className="text-[10px] text-ghost-text-muted truncate">
              {settings.selectedModel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 no-drag">
          {/* Preset switcher */}
          <div className="relative" ref={presetMenuRef}>
            <button
              onClick={() => setShowPresetMenu(prev => !prev)}
              className="p-1 rounded hover:bg-ghost-fill-strong transition-colors"
              title={`Change preset (${activePreset.name})`}
            >
              <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </button>

            {showPresetMenu && (
              <div className="absolute right-0 mt-1 w-44 max-h-64 overflow-y-auto popover rounded-lg z-50 py-1" role="menu" aria-label="Presets">
                {settings.presets.map(preset => (
                  <button
                    key={preset.id}
                    role="menuitem"
                    onClick={() => {
                      updateSettings({ activePresetId: preset.id })
                      setShowPresetMenu(false)
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] hover:bg-ghost-fill-strong transition-colors flex items-center gap-2 ${
                      preset.id === activePreset.id ? 'text-ghost-accent' : 'text-ghost-text-muted'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${preset.id === activePreset.id ? 'bg-ghost-accent' : 'bg-transparent'}`} />
                    <span className="truncate">{preset.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model switcher */}
          <div className="relative" ref={modelMenuRef}>
            <button
              onClick={() => setShowModelMenu(prev => !prev)}
              className="p-1 rounded hover:bg-ghost-fill-strong transition-colors"
              title="Change model"
            >
              <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </button>

            {showModelMenu && (
              <div className="absolute right-0 mt-1 w-44 max-h-64 overflow-y-auto popover rounded-lg z-50 py-1">
                {models.length === 0 && (
                  <div className="px-3 py-2 text-[10px] text-ghost-text-muted">No models found</div>
                )}
                {models.map(model => (
                  <button
                    key={model.name}
                    onClick={() => {
                      updateSettings({ selectedModel: model.name })
                      setShowModelMenu(false)
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] hover:bg-ghost-fill-strong transition-colors flex items-center gap-2 ${
                      model.name === settings.selectedModel ? 'text-ghost-accent' : 'text-ghost-text-muted'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${model.name === settings.selectedModel ? 'bg-ghost-accent' : 'bg-transparent'}`} />
                    <span className="truncate">{model.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Screenshot full */}
          <button
            onClick={analyzeScreenshot}
            className="p-1 rounded hover:bg-ghost-fill-strong transition-colors"
            title={`Capture full screen (${keys('screenshot')})`}
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Screenshot crop */}
          <button
            onClick={analyzeScreenshotCrop}
            className="p-1 rounded hover:bg-ghost-fill-strong transition-colors"
            title={`Capture screen region (${keys('cropScreenshot')})`}
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3v4M3 7h4m10 0h4M17 3v4M7 17v4M3 17h4m10 0h4m-4-14v14H7V3" />
            </svg>
          </button>

          {/* Save conversation */}
          <button
            onClick={handleSaveConversation}
            disabled={messages.length === 0 || isSaving}
            className="p-1 rounded hover:bg-ghost-fill-strong transition-colors disabled:opacity-30"
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
            className="p-1 rounded hover:bg-ghost-fill-strong transition-colors"
            title="Clear chat"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            className="p-1 rounded hover:bg-ghost-fill-strong transition-colors"
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
            className="p-1 rounded hover:bg-ghost-fill-strong transition-colors"
            title="Help - Shortcuts & buttons"
          >
            <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages Area */}
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
                  {connectionError ? (
                    connectionError
                  ) : (
                    <>
                      Ollama not detected. Start Ollama first.
                      <br />
                      <code className="text-[9px] opacity-80">ollama serve</code>
                    </>
                  )}
                </div>
              )}
              <div className="mt-3 space-y-1.5 text-[9px] text-ghost-text-muted opacity-50 w-full max-w-[220px]">
                <div className="flex justify-between">
                  <span>Show/Hide overlay</span>
                  <kbd className="bg-ghost-fill-strong px-1 py-0.5 rounded font-mono text-[8px]">{keys('toggleOverlay')}</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Capture screenshot</span>
                  <kbd className="bg-ghost-fill-strong px-1 py-0.5 rounded font-mono text-[8px]">{keys('screenshot')}</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Focus input</span>
                  <kbd className="bg-ghost-fill-strong px-1 py-0.5 rounded font-mono text-[8px]">{keys('focusInput')}</kbd>
                </div>
              </div>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} onSaveNotes={handleSaveNotes} />
          ))}
          <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      {messages.length > 0 && !isStreaming && activePreset.quickActions.length > 0 && (
        <div className="px-3 py-1 flex gap-1 overflow-x-auto no-drag">
          {activePreset.quickActions.map((action, i) => (
            <QuickAction
              key={`${i}-${action.label}`}
              label={action.label}
              onClick={() => sendMessage(action.prompt, undefined, { context: getTranscriptContext() })}
            />
          ))}
        </div>
      )}

      {/* Audio Capture */}
      <div className="px-3 py-1.5 border-t border-ghost-border no-drag">
          <AudioCapture
            onTranscription={(text) => {
              // sendMessage ignores requests while a reply is streaming; tell
              // AudioCapture so Auto mode retries this text on its next tick.
              if (isStreaming) return false
              // `text` is only the new/recent excerpt; the rest of the
              // conversation rides along as transcript context.
              sendMessage(fillSuggestReplyPrompt(activePreset.suggestReplyPrompt, text), undefined, { context: getTranscriptContext() })
            }}
            onSummarize={() => {
              sendMessage('Summarize the conversation transcript into clear bullet points with the key topics discussed.', undefined, { context: getTranscriptContext() })
            }}
            onSummarizePT={() => {
              sendMessage('Summarize the conversation transcript into a bullet-point list of the key topics, where each topic has a short bold title followed by a brief explanation of what was said about it. Write everything in Brazilian Portuguese (pt-BR), regardless of the original language. Provide ONLY the list, nothing else.', undefined, { context: getTranscriptContext() })
            }}
            onNotes={handleGenerateNotes}
            onTranscriptChange={handleTranscriptChange}
            isConnected={isConnected}
            canLoadWhisper={settingsLoaded}
            settings={settings}
          />
      </div>

      {/* Input */}
      <ChatInput
        ref={inputRef}
        onSend={(content) => {
          // Any live transcript goes along as context, not inside the message
          sendMessage(content, undefined, { context: getTranscriptContext() })
        }}
        onStop={stopGeneration}
        focusShortcut={keys('focusInput')}
        queuedCount={queuedCount}
        isStreaming={isStreaming}
        isConnected={isConnected}
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
