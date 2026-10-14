import { useState, useRef, useCallback, useEffect } from 'react'
import { DEFAULT_SPEAKER_THRESHOLD, SpeakerClusterer } from '../lib/diarization'
import type { Channel } from './useTranscriptionQueue'

type EmbedStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Speakers mode (hybrid diarization): the mic channel is "You"; system-audio
 * segments are fingerprinted by the local speaker-embedding model (main
 * process) and clustered into A/B/C. Falls back to "Other" when the model
 * isn't ready. The threshold is read live, so Settings changes apply to the
 * next segment.
 */
export function useDiarization(speakerThreshold: number | undefined) {
  const [enabled, setEnabled] = useState(false)
  const [embedStatus, setEmbedStatus] = useState<EmbedStatus>('idle')
  const [embedProgress, setEmbedProgress] = useState(0)
  const clustererRef = useRef(new SpeakerClusterer())
  // Read inside the transcription queue, outside React's render cycle
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const embedReadyRef = useRef(false)
  embedReadyRef.current = embedStatus === 'ready'
  const thresholdRef = useRef(speakerThreshold ?? DEFAULT_SPEAKER_THRESHOLD)
  thresholdRef.current = speakerThreshold ?? DEFAULT_SPEAKER_THRESHOLD

  // Speaker-embedding model: listen for load progress
  useEffect(() => {
    return window.ghostAPI.onEmbedProgress((data) => {
      if (data.status === 'download') {
        setEmbedStatus('loading')
        setEmbedProgress(data.progress)
      } else if (data.status === 'ready') {
        setEmbedStatus('ready')
        setEmbedProgress(100)
      } else if (data.status === 'error') {
        setEmbedStatus('error')
      }
    })
  }, [])

  const loadEmbed = useCallback(async () => {
    if (embedStatus === 'ready' || embedStatus === 'loading') return
    setEmbedStatus('loading')
    setEmbedProgress(0)
    try {
      const r = await window.ghostAPI.embedLoad()
      if (r.status === 'ready') setEmbedStatus('ready')
      else if (r.status === 'error') setEmbedStatus('error')
    } catch {
      setEmbedStatus('error')
    }
  }, [embedStatus])

  // When diarization is turned on, preload the speaker-embedding model
  useEffect(() => {
    if (enabled && embedStatus === 'idle') loadEmbed()
  }, [enabled, embedStatus, loadEmbed])

  // Speaker label for a transcribed segment ('' when Speakers is off).
  // `audio16k` is the segment resampled to 16 kHz.
  const labelFor = useCallback(async (channel: Channel, audio16k: Float32Array): Promise<string> => {
    if (!enabledRef.current) return ''
    if (channel === 'mic') return 'You'
    let embedding: number[] | null = null
    if (embedReadyRef.current) {
      try {
        const res = await window.ghostAPI.embedSpeaker(audio16k.buffer as ArrayBuffer)
        if (res.success && res.embedding) embedding = res.embedding
      } catch { /* ignore embedding failures */ }
    }
    return clustererRef.current.assign(embedding, thresholdRef.current)
  }, [])

  const reset = useCallback(() => clustererRef.current.reset(), [])

  return { enabled, setEnabled, embedStatus, embedProgress, loadEmbed, labelFor, reset }
}
