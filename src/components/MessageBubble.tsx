import type { ChatMessage } from '../types'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div
      className={`animate-slide-up ${isUser ? 'flex justify-end' : ''}`}
    >
      <div
        className={`max-w-[90%] rounded-xl px-3 py-2 ${
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
