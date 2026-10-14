import { useState, useRef, useCallback, useEffect } from 'react'

export type Channel = 'mic' | 'system'

// A closed speech segment waiting for Whisper
export interface QueuedSegment {
  channel: Channel
  audio: Float32Array
  sampleRate: number
  endedAt: number // Date.now() when the segment closed (echo matching)
}

// If Whisper falls this far behind real time, the oldest segments are dropped
// rather than letting latency grow without bound.
export const MAX_QUEUED_SEGMENTS = 30

/**
 * Serial transcription queue: segments are processed one at a time, in the
 * order they were spoken. `process` is read through a ref, so audio callbacks
 * created once per graph always call the latest version.
 */
export function useTranscriptionQueue(process: (segment: QueuedSegment) => Promise<void>) {
  const [isTranscribing, setIsTranscribing] = useState(false)
  const queueRef = useRef<QueuedSegment[]>([])
  const drainPromiseRef = useRef<Promise<void> | null>(null)
  const processRef = useRef(process)
  useEffect(() => {
    processRef.current = process
  }, [process])

  // Returns the running pass if there is one, so callers can await the backlog.
  const drain = useCallback((): Promise<void> => {
    if (drainPromiseRef.current) return drainPromiseRef.current
    if (queueRef.current.length === 0) return Promise.resolve()
    const run = async () => {
      setIsTranscribing(true)
      try {
        let item: QueuedSegment | undefined
        while ((item = queueRef.current.shift())) {
          try {
            await processRef.current(item)
          } catch (err) {
            console.error('Transcription error:', err)
          }
        }
      } finally {
        setIsTranscribing(false)
      }
    }
    drainPromiseRef.current = run().finally(() => { drainPromiseRef.current = null })
    return drainPromiseRef.current
  }, [])

  const enqueue = useCallback((segment: QueuedSegment) => {
    const queue = queueRef.current
    queue.push(segment)
    if (queue.length > MAX_QUEUED_SEGMENTS) {
      queue.shift()
      console.warn('[AudioCapture] Whisper is falling behind; dropped the oldest queued segment')
    }
    void drain()
  }, [drain])

  const clear = useCallback(() => {
    queueRef.current = []
  }, [])

  return { isTranscribing, enqueue, drain, clear }
}
