import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../types'
import { hasSessionContent, sessionTitle, toSessionMessages, type Session } from '../lib/sessions'

export const SESSION_SAVE_DELAY_MS = 1000

interface SessionHistoryInput {
  enabled: boolean // settings.saveSessions (and settings loaded)
  messages: ChatMessage[]
  transcript: string // formatted with speaker names
  model: string
  preset: string
}

/**
 * Keeps the current session (transcript + chat + notes) saved in history while
 * saving is on: a short debounce after each change, never mid-stream. Clearing
 * the chat or the transcript starts a new session, so the saved one keeps what
 * was cleared. Nothing is written while saving is off.
 */
export function useSessionHistory({ enabled, messages, transcript, model, preset }: SessionHistoryInput) {
  const sessionRef = useRef<{ id: string; startedAt: number } | null>(null)
  const prevRef = useRef({ messageCount: messages.length, transcript })

  // A cleared chat or transcript closes the current session
  useEffect(() => {
    const prev = prevRef.current
    if ((prev.messageCount > 0 && messages.length === 0) || (prev.transcript.trim() && !transcript.trim())) {
      sessionRef.current = null
    }
    prevRef.current = { messageCount: messages.length, transcript }
  }, [messages, transcript])

  useEffect(() => {
    if (!enabled || !hasSessionContent(messages, transcript)) return
    if (messages.some(m => m.isStreaming)) return // saved once the reply is complete
    const timer = setTimeout(() => {
      if (!sessionRef.current) sessionRef.current = { id: crypto.randomUUID(), startedAt: Date.now() }
      const sessionMessages = toSessionMessages(messages)
      const session: Session = {
        ...sessionRef.current,
        updatedAt: Date.now(),
        title: sessionTitle(sessionMessages, transcript),
        model,
        preset,
        transcript,
        messages: sessionMessages,
      }
      window.ghostAPI.sessionsSave(session).catch(() => { /* history is best effort */ })
    }, SESSION_SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, messages, transcript, model, preset])
}
