import { forwardRef, useState, useCallback, useEffect } from 'react'

interface ChatInputProps {
  onSend: (message: string) => void
  // Stops the reply that is streaming (button + Esc)
  onStop?: () => void
  // Requests waiting for the current reply to finish
  queuedCount?: number
  // Label of the global "focus input" shortcut, shown in the placeholder
  focusShortcut?: string
  isStreaming: boolean
  isConnected: boolean
}

export const ChatInput = forwardRef<HTMLInputElement, ChatInputProps>(
  ({ onSend, onStop, queuedCount = 0, focusShortcut = 'Cmd+Shift+A', isStreaming, isConnected }, ref) => {
    const [input, setInput] = useState('')

    // Esc stops generation. The input is disabled while streaming, so listen
    // on the window instead of the field.
    useEffect(() => {
      if (!isStreaming || !onStop) return
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onStop()
      }
      window.addEventListener('keydown', handleKey)
      return () => window.removeEventListener('keydown', handleKey)
    }, [isStreaming, onStop])

    const handleSubmit = useCallback(
      (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || isStreaming || !isConnected) return
        onSend(input.trim())
        setInput('')
      },
      [input, isStreaming, isConnected, onSend]
    )

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
          setInput('')
          ;(e.target as HTMLInputElement).blur()
        }
      },
      []
    )

    return (
      <form
        onSubmit={handleSubmit}
        className="px-3 py-2 border-t border-ghost-border no-drag"
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={ref}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !isConnected
                  ? 'Ollama disconnected...'
                  : isStreaming
                    ? `Generating response...${queuedCount > 0 ? ` (${queuedCount} queued)` : ''}`
                    : `Ask something... (${focusShortcut})`
              }
              disabled={!isConnected || isStreaming}
              className="w-full bg-ghost-fill border border-ghost-border rounded-lg px-3 py-1.5 text-xs text-ghost-text placeholder-ghost-text-muted/50 focus:outline-none focus:border-ghost-accent focus:ring-2 focus:ring-ghost-accent/30 transition-colors disabled:opacity-40"
              autoComplete="off"
              spellCheck={false}
            />
            {isStreaming && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <div className="flex gap-0.5">
                  <div className="w-1 h-1 rounded-full bg-ghost-accent animate-pulse-dot" style={{ animationDelay: '0s' }} />
                  <div className="w-1 h-1 rounded-full bg-ghost-accent animate-pulse-dot" style={{ animationDelay: '0.3s' }} />
                  <div className="w-1 h-1 rounded-full bg-ghost-accent animate-pulse-dot" style={{ animationDelay: '0.6s' }} />
                </div>
              </div>
            )}
          </div>

          {isStreaming && onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="p-1.5 rounded-lg bg-ghost-error/80 hover:bg-ghost-error transition-colors"
              title="Stop generating (Esc)"
            >
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || isStreaming || !isConnected}
              className="p-1.5 rounded-lg bg-ghost-accent hover:bg-ghost-accent-hover disabled:opacity-30 disabled:hover:bg-ghost-accent transition-colors"
              title="Send"
            >
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
          )}
        </div>
      </form>
    )
  }
)

ChatInput.displayName = 'ChatInput'
