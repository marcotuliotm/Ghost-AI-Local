import { useState, useCallback } from 'react'
import type { ChatMessage } from '../types'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!message.content) return
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable; ignore silently
    }
  }, [message.content])

  return (
    <div
      className={`animate-slide-up ${isUser ? 'flex justify-end' : ''}`}
    >
      <div
        className={`group max-w-[90%] rounded-xl px-3 py-2 ${
          isUser
            ? 'bg-ghost-accent/20 text-ghost-text'
            : 'bg-white/5 text-ghost-text'
        }`}
      >
        {/* Role indicator */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`text-[9px] font-medium uppercase tracking-wider ${
            isUser ? 'text-ghost-accent' : 'text-ghost-text-muted'
          }`}>
            {isUser ? 'You' : 'Ghost'}
          </span>
          <span className="text-[8px] text-ghost-text-muted opacity-40">
            {formatTime(message.timestamp)}
          </span>
          {message.isStreaming && (
            <span className="text-[8px] text-ghost-accent animate-pulse-dot">
              typing...
            </span>
          )}

          {/* Copy button */}
          {message.content && !message.isStreaming && (
            <button
              onClick={handleCopy}
              className="ml-auto p-0.5 rounded text-ghost-text-muted opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
              title={copied ? 'Copied!' : 'Copy message'}
            >
              {copied ? (
                <svg className="w-3 h-3 text-ghost-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Screenshot preview */}
        {message.screenshot && (
          <div className="mb-2 rounded-lg overflow-hidden border border-ghost-border">
            <img
              src={message.screenshot}
              alt="Screenshot"
              className="w-full h-auto max-h-32 object-cover"
            />
          </div>
        )}

        {/* Message content */}
        <div className="response-content text-xs leading-relaxed whitespace-pre-wrap break-words">
          {message.content || (message.isStreaming ? '' : '')}
          {message.isStreaming && !message.content && (
            <span className="cursor-blink text-ghost-text-muted">Thinking</span>
          )}
        </div>
      </div>
    </div>
  )
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
