import { useState, useRef, useCallback, useEffect } from 'react'
import { transcriptDelta } from '../lib/context'

export const AUTO_SEND_MIN_SECONDS = 10
export const AUTO_SEND_MAX_SECONDS = 120

/**
 * Auto mode: while `active` (recording), every `intervalSec` send only what
 * was transcribed since the last send. If `send` returns false (a reply is
 * still streaming), the text stays pending and the next tick retries, so no
 * part of the conversation is silently skipped. `getTranscript` and `send` are
 * read through refs, so the timer never sees stale values.
 */
export function useAutoSend(
  active: boolean,
  getTranscript: () => string,
  send: (delta: string) => boolean | void,
) {
  const [enabled, setEnabled] = useState(false)
  const [intervalSec, setIntervalSec] = useState(30)
  const lastSentRef = useRef('')
  const getRef = useRef(getTranscript)
  getRef.current = getTranscript
  const sendRef = useRef(send)
  sendRef.current = send

  const tick = useCallback(() => {
    const text = getRef.current().trim()
    const delta = transcriptDelta(text, lastSentRef.current)
    if (!delta) return
    if (sendRef.current(delta) === false) return
    lastSentRef.current = text
  }, [])

  // The timer runs only while Auto is on and recording (it stops during a
  // stream auto-restart and resumes after); a new interval restarts it.
  useEffect(() => {
    if (!enabled || !active) return
    const timer = setInterval(tick, intervalSec * 1000)
    return () => clearInterval(timer)
  }, [enabled, active, intervalSec, tick])

  // Something else already sent up to `text` (e.g. a detected question)
  const markSent = useCallback((text: string) => {
    lastSentRef.current = text.trim()
  }, [])

  const changeInterval = useCallback((deltaSec: number) => {
    setIntervalSec(v => Math.min(AUTO_SEND_MAX_SECONDS, Math.max(AUTO_SEND_MIN_SECONDS, v + deltaSec)))
  }, [])

  return { enabled, setEnabled, intervalSec, changeInterval, markSent }
}
