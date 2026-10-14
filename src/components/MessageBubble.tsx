import { useState, useCallback, useEffect, useRef } from 'react'
import type { ChatMessage } from '../types'
import { Markdown } from './Markdown'

interface MessageBubbleProps {
  message: ChatMessage
  // Shown on finished meeting-notes replies (kind 'notes')
  onSaveNotes?: (markdown: string) => Promise<void> | void
}

export function MessageBubble({ message, onSaveNotes }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)

  // The AI file name can take a moment; show progress and ignore repeat clicks
  const handleSaveNotes = useCallback(async () => {
    if (!onSaveNotes || savingNotes) return
    setSavingNotes(true)
    try {
      await onSaveNotes(message.content)
    } finally {
      setSavingNotes(false)
    }
  }, [onSaveNotes, savingNotes, message.content])

  const handleCopy = useCallback(async () => {
    if (!message.content) return
    try {
      // Prefer Electron's native clipboard (web clipboard perms are restricted
      // by the app's permission handler); fall back to the web API in a browser.
      if (window.ghostAPI?.copyText) {
        await window.ghostAPI.copyText(message.content)
      } else {
        await navigator.clipboard.writeText(message.content)
      }
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
            : 'bg-ghost-fill text-ghost-text'
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

          {/* Save meeting notes as Markdown */}
          {message.kind === 'notes' && onSaveNotes && message.content && !message.isStreaming && (
            <button
              onClick={handleSaveNotes}
              disabled={savingNotes}
              className="ml-auto px-1.5 py-0.5 rounded text-[8px] font-medium bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 dark:hover:bg-amber-500/35 disabled:opacity-60 transition-colors"
              title="Save notes to a .md file"
            >
              {savingNotes ? 'Saving...' : 'Save .md'}
            </button>
          )}

          {/* Copy button */}
          {message.content && !message.isStreaming && (
            <button
              onClick={handleCopy}
              className={`${message.kind === 'notes' && onSaveNotes ? '' : 'ml-auto '}p-0.5 rounded text-ghost-text-muted opacity-0 group-hover:opacity-100 hover:bg-ghost-fill-strong transition-all`}
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

        {/* Model reasoning (thinking models), collapsed once the answer starts */}
        {!isUser && message.thinking && (
          <Reasoning text={message.thinking} live={Boolean(message.isStreaming && !message.content)} />
        )}

        {/* Message content: the user's text as typed, replies as Markdown */}
        {isUser ? (
          <div className="text-xs leading-relaxed whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className="response-content text-xs leading-relaxed break-words">
            {message.content && <Markdown text={message.content} />}
            {message.isStreaming && !message.content && !message.thinking && (
              <span className="cursor-blink text-ghost-text-muted">Thinking</span>
            )}
            {message.stopped && (
              <span className="block text-[9px] text-ghost-text-muted italic mt-1">Stopped</span>
            )}
            {message.sources && message.sources.length > 0 && (
              <span className="block text-[9px] text-ghost-text-muted mt-1" title="Excerpts from these documents were sent with the request">
                From: {message.sources.join(', ')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// The reasoning stays open and follows the newest text while the model is
// still thinking; once the answer starts it collapses (click to reopen).
function Reasoning({ text, live }: { text: string; live: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (live && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [text, live])

  return (
    <details open={live} className="mb-1.5 rounded-md bg-ghost-fill px-2 py-1">
      <summary className="cursor-pointer select-none text-[9px] text-ghost-text-muted">
        {live ? <span className="animate-pulse">Reasoning...</span> : 'Reasoning'}
      </summary>
      <div
        ref={bodyRef}
        className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-ghost-text-muted"
      >
        {text}
      </div>
    </details>
  )
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
