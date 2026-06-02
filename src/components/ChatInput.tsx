import { forwardRef, useState, useCallback } from 'react'

interface ChatInputProps {
  onSend: (message: string) => void
  isStreaming: boolean
  isConnected: boolean
}

export const ChatInput = forwardRef<HTMLInputElement, ChatInputProps>(
  ({ onSend, isStreaming, isConnected }, ref) => {
    const [input, setInput] = useState('')

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
                    ? 'Generating response...'
                    : 'Ask something... (Cmd+Shift+A)'
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
        </div>
      </form>
    )
  }
)

ChatInput.displayName = 'ChatInput'
