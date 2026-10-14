import { useState, useRef, useCallback, useEffect } from 'react'
import { SpeechSegmenter } from '../lib/segmenter'
import { createCaptureNode, loadCaptureWorklet } from '../lib/audio'
import type { Channel, QueuedSegment } from './useTranscriptionQueue'

export type CaptureStatus = 'idle' | 'requesting' | 'listening' | 'error'
export type AudioSource = 'mic' | 'system' | 'both'

interface AudioGraphOptions {
  // A closed speech segment (pause or max length) ready for Whisper
  onSegment: (segment: QueuedSegment) => void
  // Max segment length; applied live, including mid-recording
  maxSegmentSeconds: number
}

// Get microphone stream
async function getMicStream(): Promise<MediaStream> {
  let granted = true
  try {
    granted = (await window.ghostAPI.requestMicPermission()).granted
  } catch {
    // The permission query itself failed; let getUserMedia decide below.
  }
  if (!granted) {
    throw new Error('Microphone permission denied. Enable in System Settings > Privacy > Microphone.')
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
}

// Get system audio stream via getDisplayMedia + loopback
async function getSystemStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,  // Required by the API, but we only use audio
    audio: true,  // System audio via loopback (macOS 13+ ScreenCaptureKit)
  })

  for (const track of stream.getVideoTracks()) {
    track.stop()
  }

  if (stream.getAudioTracks().length === 0) {
    throw new Error('No system audio captured. Check Screen Recording permission in System Settings > Privacy.')
  }

  return stream
}

async function openStreams(source: AudioSource): Promise<{ stream: MediaStream; channel: Channel }[]> {
  const streams: { stream: MediaStream; channel: Channel }[] = []
  if (source === 'mic' || source === 'both') {
    streams.push({ stream: await getMicStream(), channel: 'mic' })
  }
  if (source === 'system' || source === 'both') {
    streams.push({ stream: await getSystemStream(), channel: 'system' })
  }
  return streams
}

/**
 * The capture side of AudioCapture: opens the mic / system-audio streams, runs
 * each channel through an AudioWorklet (ScriptProcessor fallback) into its own
 * VAD segmenter, drives the level meter and duration counter, and reconnects
 * by itself when macOS kills the system-audio stream (ScreenCaptureKit
 * timeout, ~20 min) without touching the transcript.
 */
export function useAudioGraph({ onSegment, maxSegmentSeconds }: AudioGraphOptions) {
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [duration, setDuration] = useState(0)
  const [streamDied, setStreamDied] = useState(false)

  const streamsRef = useRef<MediaStream[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const captureNodesRef = useRef<AudioNode[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isListeningRef = useRef(false)
  const restartingRef = useRef(false)
  const sourceRef = useRef<AudioSource>('system')
  // One VAD segmenter per channel so speech is attributed to mic vs system
  const segmentersRef = useRef<Partial<Record<Channel, SpeechSegmenter>>>({})
  const onSegmentRef = useRef(onSegment)
  onSegmentRef.current = onSegment
  const maxSegmentRef = useRef(maxSegmentSeconds || 10)

  // Max segment length follows Settings live, including mid-recording
  useEffect(() => {
    maxSegmentRef.current = maxSegmentSeconds || 10
    for (const seg of Object.values(segmentersRef.current)) {
      seg?.setMaxSegmentSeconds(maxSegmentRef.current)
    }
  }, [maxSegmentSeconds])

  const emit = (channel: Channel, audio: Float32Array, sampleRate: number) =>
    onSegmentRef.current({ channel, audio, sampleRate, endedAt: Date.now() })

  // Tear the graph down (streams, nodes, timers). Open segments are kept.
  const stopGraph = useCallback(() => {
    isListeningRef.current = false
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
    for (const node of captureNodesRef.current) {
      try { node.disconnect() } catch {}
      if ('port' in node) (node as AudioWorkletNode).port.onmessage = null
    }
    captureNodesRef.current = []
    if (audioContextRef.current) {
      try { audioContextRef.current.close() } catch {}
      audioContextRef.current = null
    }
    for (const stream of streamsRef.current) {
      stream.getTracks().forEach(t => t.stop())
    }
    streamsRef.current = []
  }, [])

  // Close any open segments (Stop / stream restart) and emit them.
  const flushSegmenters = useCallback((sampleRate: number) => {
    for (const channel of ['system', 'mic'] as Channel[]) {
      const audio = segmentersRef.current[channel]?.flush()
      if (audio) emit(channel, audio, sampleRate)
    }
    segmentersRef.current = {}
  }, [])

  // Wire a single stream into the audio graph: its PCM goes through the
  // channel's VAD segmenter, and it feeds the shared level-meter analyser.
  const wireStream = useCallback((stream: MediaStream, channel: Channel, audioContext: AudioContext, analyser: AnalyserNode, useWorklet: boolean) => {
    const src = audioContext.createMediaStreamSource(stream)
    src.connect(analyser)

    const sampleRate = audioContext.sampleRate
    const segmenter = new SpeechSegmenter({ sampleRate, maxSegmentSeconds: maxSegmentRef.current })
    segmentersRef.current[channel] = segmenter

    const node = createCaptureNode(audioContext, useWorklet, (samples) => {
      if (!isListeningRef.current) return
      for (const audio of segmenter.push(samples)) emit(channel, audio, sampleRate)
    })
    src.connect(node)
    // Connected to the destination so the graph keeps pulling it; its output is silence.
    node.connect(audioContext.destination)
    captureNodesRef.current.push(node)

    // Detect when macOS kills the audio stream (ScreenCaptureKit timeout ~20 min)
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        console.warn('[AudioCapture] Audio track ended (OS killed stream)')
        if (isListeningRef.current) setStreamDied(true)
      }
    }
  }, [])

  // Build the full capture graph for the selected source (used by start + restart)
  const buildGraph = useCallback(async (streams: { stream: MediaStream; channel: Channel }[]) => {
    const audioContext = new AudioContext()
    audioContextRef.current = audioContext

    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256

    const useWorklet = await loadCaptureWorklet(audioContext)
    // Stopped (or restarted) while the worklet was loading
    if (audioContextRef.current !== audioContext) return

    for (const { stream, channel } of streams) {
      wireStream(stream, channel, audioContext, analyser, useWorklet)
    }

    // Level visualization
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const updateLevel = () => {
      if (!isListeningRef.current) return
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      setAudioLevel(avg / 255)
      animationFrameRef.current = requestAnimationFrame(updateLevel)
    }
    updateLevel()
  }, [wireStream])

  const startDurationTimer = () => {
    durationIntervalRef.current = setInterval(() => setDuration(d => d + 1), 1000)
  }

  /**
   * Start recording `source`. `onStarted` runs once the streams are open,
   * before audio flows (the caller resets its transcript there).
   */
  const start = useCallback(async (source: AudioSource, onStarted?: () => void) => {
    setErrorMsg('')
    setStatus('requesting')
    try {
      const streams = await openStreams(source)
      sourceRef.current = source
      streamsRef.current = streams.map(s => s.stream)
      isListeningRef.current = true
      setStatus('listening')
      setDuration(0)
      segmentersRef.current = {}
      onStarted?.()
      await buildGraph(streams)
      startDurationTimer()
    } catch (err: any) {
      setStatus('error')
      if (err.name === 'NotAllowedError') {
        setErrorMsg(
          source === 'mic'
            ? 'Microphone permission denied.'
            : 'Screen recording permission denied. Enable in System Settings > Privacy > Screen Recording.'
        )
      } else if (err.name === 'NotFoundError') {
        setErrorMsg('No audio device found.')
      } else {
        setErrorMsg(err.message || `Error: ${err}`)
      }
    }
  }, [buildGraph])

  // Stop capturing; the phrase in progress is emitted as a last segment.
  // The caller drains its queue, then calls finish().
  const stop = useCallback(() => {
    const sampleRate = audioContextRef.current?.sampleRate || 48000
    stopGraph()
    flushSegmenters(sampleRate)
  }, [stopGraph, flushSegmenters])

  const finish = useCallback(() => {
    setStatus('idle')
    setAudioLevel(0)
    setDuration(0)
  }, [])

  // Auto-restart when stream dies (macOS ScreenCaptureKit timeout ~20 min)
  useEffect(() => {
    if (!streamDied || restartingRef.current) return

    const restartCapture = async () => {
      restartingRef.current = true
      console.log('[AudioCapture] Stream died, auto-restarting...')

      // Keep whatever was being said when the stream died
      stop()
      setStreamDied(false)
      setStatus('requesting')
      setErrorMsg('')

      try {
        const streams = await openStreams(sourceRef.current)
        streamsRef.current = streams.map(s => s.stream)
        isListeningRef.current = true
        setStatus('listening')
        await buildGraph(streams)
        // Continue the duration count instead of resetting it
        startDurationTimer()
        console.log('[AudioCapture] Stream restarted successfully')
      } catch (err: any) {
        console.error('[AudioCapture] Failed to restart stream:', err)
        setStatus('error')
        setErrorMsg(`Stream lost. ${err.message || err}`)
      } finally {
        restartingRef.current = false
      }
    }

    restartCapture()
  }, [streamDied, stop, buildGraph])

  // Cleanup on unmount
  useEffect(() => () => stopGraph(), [stopGraph])

  return { status, errorMsg, setErrorMsg, audioLevel, duration, streamDied, start, stop, finish }
}
