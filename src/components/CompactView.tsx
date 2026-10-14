import { useEffect, useMemo, useRef } from 'react'
import type { ChatMessage } from '../types'
import { Markdown } from './Markdown'

interface CompactViewProps {
  messages: ChatMessage[]
  isStreaming: boolean
  onExpand: () => void
  // Label of the compact-mode shortcut ("Cmd+Shift+M")
  shortcutLabel: string
}

/**
 * Compact mode: a small card showing only the latest suggestion, sitting over
 * the call. The card lets clicks through to the window underneath; the toolbar
 * (drag handle + expand) turns the mouse back on while hovered. Recording and
 * Auto/Questions keep running in the hidden overlay.
 */
export function CompactView({ messages, isStreaming, onExpand, shortcutLabel }: CompactViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const latest = useMemo(() => [...messages].reverse().find(m => m.role === 'assistant'), [messages])

  // Click-through while compact; the main process restores the mouse on exit
  useEffect(() => {
    window.ghostAPI.setIgnoreMouse(true)
    return () => window.ghostAPI.setIgnoreMouse(false)
  }, [])

  // Follow the end of a streaming reply (the card can't be scrolled by hand)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [latest?.content, latest?.thinking])

  const interactive = {
    onMouseEnter: () => window.ghostAPI.setIgnoreMouse(false),
    onMouseLeave: () => window.ghostAPI.setIgnoreMouse(true),
  }

  const thinkingTail = latest?.isStreaming && !latest.content && latest.thinking
    ? latest.thinking.trim().split('\n').slice(-2).join(' ')
    : ''

  return (
    <div className="w-full h-full flex flex-col glass rounded-xl overflow-hidden animate-fade-in" data-testid="compact-view">
      <div className="flex items-center gap-1.5 pl-3 pr-1.5 h-7 border-b border-ghost-border no-drag" {...interactive}>
        <div className="drag-region flex-1 h-full flex items-center gap-1.5 min-w-0" title="Drag to move">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isStreaming ? 'bg-ghost-accent animate-pulse-dot' : 'bg-ghost-success'}`} />
          <span className="text-[9px] text-ghost-text-muted truncate">
            {isStreaming ? 'Thinking...' : 'Latest suggestion'}
          </span>
        </div>
        <button
          onClick={onExpand}
          className="p-1 rounded hover:bg-ghost-fill-strong transition-colors"
          title={`Expand (${shortcutLabel})`}
        >
          <svg className="w-3 h-3 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
          </svg>
        </button>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-hidden px-3 py-2 response-content text-xs leading-relaxed break-words">
        {latest?.content ? (
          <Markdown text={latest.content} />
        ) : thinkingTail ? (
          <p className="text-[10px] text-ghost-text-muted italic">{thinkingTail}</p>
        ) : (
          <p className="text-[10px] text-ghost-text-muted opacity-70">
            Suggestions appear here. Use Questions, Auto or the shortcuts — recording keeps running.
          </p>
        )}
      </div>
    </div>
  )
}
