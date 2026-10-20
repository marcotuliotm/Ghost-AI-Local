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

// Content to leave out of later saves: what the deleted session held
interface Baseline {
  messageIds: Set<string>
  transcriptLength: number
}

/**
 * Keeps the current session (transcript + chat + notes) saved in history while
 * saving is on: a short debounce after each change, never mid-stream. Clearing
 * the chat or the transcript starts a new session, so the saved one keeps what
 * was cleared. Deleting the open session in History starts a new one holding
 * only what comes after. Nothing is written while saving is off.
 */
export function useSessionHistory({ enabled, messages, transcript, model, preset }: SessionHistoryInput) {
  const sessionRef = useRef<{ id: string; startedAt: number } | null>(null)
  const baselineRef = useRef<Baseline | null>(null)
  // What the current session's last successful save held (on screen, unfiltered)
  const lastSavedRef = useRef<Baseline | null>(null)
  const prevRef = useRef({ messageCount: messages.length, transcript })

  // A cleared chat or transcript closes the current session
  useEffect(() => {
    const prev = prevRef.current
    const chatCleared = prev.messageCount > 0 && messages.length === 0
    const transcriptCleared = Boolean(prev.transcript.trim()) && !transcript.trim()
    if (chatCleared || transcriptCleared) {
      sessionRef.current = null
      lastSavedRef.current = null
    }
    const baseline = baselineRef.current
    if (baseline) {
      if (chatCleared) baseline.messageIds = new Set()
      if (transcriptCleared || transcript.length < baseline.transcriptLength) baseline.transcriptLength = 0
    }
    prevRef.current = { messageCount: messages.length, transcript }
  }, [messages, transcript])

  useEffect(() => {
    if (!enabled) return
    const baseline = baselineRef.current
    const keptMessages = baseline ? messages.filter(m => !baseline.messageIds.has(m.id)) : messages
    const keptTranscript = baseline ? transcript.slice(baseline.transcriptLength).trimStart() : transcript
    if (!hasSessionContent(keptMessages, keptTranscript)) return
    if (messages.some(m => m.isStreaming)) return // saved once the reply is complete
    const timer = setTimeout(() => {
      if (!sessionRef.current) sessionRef.current = { id: crypto.randomUUID(), startedAt: Date.now() }
      const sessionMessages = toSessionMessages(keptMessages)
      const session: Session = {
        ...sessionRef.current,
        updatedAt: Date.now(),
        title: sessionTitle(sessionMessages, keptTranscript),
        model,
        preset,
        transcript: keptTranscript,
        messages: sessionMessages,
      }
      const snapshot: Baseline = { messageIds: new Set(messages.map(m => m.id)), transcriptLength: transcript.length }
      window.ghostAPI.sessionsSave(session).then(result => {
        if (sessionRef.current?.id !== session.id) return
        if (result?.success) {
          lastSavedRef.current = snapshot
        } else if (result?.deleted) {
          // Deleted in History: what it held stays out; anything newer goes to a new session
          sessionRef.current = null
          const deleted = lastSavedRef.current ?? snapshot
          baselineRef.current = {
            messageIds: new Set([...(baselineRef.current?.messageIds ?? []), ...deleted.messageIds]),
            transcriptLength: Math.max(baselineRef.current?.transcriptLength ?? 0, deleted.transcriptLength),
          }
          lastSavedRef.current = null
        }
      }).catch(() => { /* history is best effort */ })
    }, SESSION_SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, messages, transcript, model, preset])
}
