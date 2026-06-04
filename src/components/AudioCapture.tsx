import { useState, useRef, useCallback, useEffect } from 'react'
import { useWhisper } from '../hooks/useWhisper'

interface AudioCaptureProps {
  onTranscription: (text: string) => void
  onSummarize: (text: string) => void
  onTranslate: (text: string) => void
  onTranscriptChange?: (text: string) => void
  isConnected: boolean
  settings: { selectedModel: string; ollamaBaseUrl: string; transcriptionInterval: number; speakerThreshold: number }
}

type CaptureStatus = 'idle' | 'requesting' | 'listening' | 'error'
type AudioSource = 'mic' | 'system' | 'both'
type Channel = 'mic' | 'system'

// A piece of transcript attributed to a speaker. speaker '' means unlabeled
// (diarization off) — rendered as a plain flowing paragraph.
interface TranscriptSegment {
  speaker: string // 'You' | 'A' | 'B' | 'C' | 'Other' | ''
  text: string
}

// Default cosine-similarity threshold for grouping system-audio chunks into the
// same speaker. Embeddings are L2-normalized, so dot product == cosine similarity.
// wavlm-base-plus-sv was tuned around 0.86 (same speaker scores above, different
// speakers below). Lower → speakers merge into one; higher → one person splits
// into several. User-tunable via Settings (settings.speakerThreshold).
const DEFAULT_SPEAKER_THRESHOLD = 0.85

// Known Whisper hallucination patterns when audio is silence/noise
const HALLUCINATION_PATTERNS = [
  /^you\.?$/i,
  /^the\.?$/i,
  /^thank you\.?$/i,
  /^thanks for watching\.?$/i,
  /^bye\.?$/i,
  /^okay\.?$/i,
  /^uh\.?$/i,
  /^um\.?$/i,
  /^\.+$/,
  /^\s*$/,
]

function isHallucination(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length < 3) return true
  return HALLUCINATION_PATTERNS.some(p => p.test(trimmed))
}

function hasAudioEnergy(audio: Float32Array, threshold = 0.002): boolean {
  let sum = 0
  for (let i = 0; i < audio.length; i++) {
    sum += audio[i] * audio[i]
  }
  const rms = Math.sqrt(sum / audio.length)
  return rms > threshold
}

function dot(a: number[], b: number[]): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

// Format labeled segments into text for Ollama / save / context. Labels give
// the LLM useful turn-taking context ("You: ... / Speaker A: ...").
function formatSegments(segs: TranscriptSegment[]): string {
  return segs
    .map(s => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join('\n')
    .trim()
}

// Visual style per speaker label
function speakerChipClass(label: string): string {
  switch (label) {
    case 'You': return 'bg-ghost-accent/20 text-ghost-accent'
    case 'A': return 'bg-green-500/20 text-green-700 dark:text-green-300'
    case 'B': return 'bg-purple-500/20 text-purple-700 dark:text-purple-300'
    case 'C': return 'bg-orange-500/20 text-orange-700 dark:text-orange-300'
    case 'D': return 'bg-pink-500/20 text-pink-700 dark:text-pink-300'
    default: return 'bg-ghost-fill-strong text-ghost-text-muted'
  }
}

async function resampleTo16kHz(audioData: Float32Array, fromSampleRate: number): Promise<Float32Array> {
  if (fromSampleRate === 16000) return audioData
  const numOutputSamples = Math.round(audioData.length * 16000 / fromSampleRate)
  const offlineCtx = new OfflineAudioContext(1, numOutputSamples, 16000)
  const buffer = offlineCtx.createBuffer(1, audioData.length, fromSampleRate)
  buffer.copyToChannel(new Float32Array(audioData) as unknown as Float32Array<ArrayBuffer>, 0)
  const source = offlineCtx.createBufferSource()
  source.buffer = buffer
  source.connect(offlineCtx.destination)
  source.start()
  const rendered = await offlineCtx.startRendering()
  return new Float32Array(rendered.getChannelData(0))
}

/**
 * AudioCapture - 100% local audio transcription with speaker separation.
 *
 * Sources:
 * - Mic: your microphone (labeled "You")
 * - System: desktop audio (meetings/videos) — diarized into Speaker A/B/C
 * - Both: mic + system, captured on separate channels
 *
 * Hybrid diarization: mic vs system is split by channel ("You" vs the other
 * side). When "Speakers" is enabled, system-audio chunks are additionally
 * fingerprinted with a local speaker-embedding model and clustered into A/B/C.
 *
 * Flow: each channel → Raw PCM → Whisper (text) [+ embedding for system] → labeled transcript
 */
export function AudioCapture({ onTranscription, onSummarize, onTranslate, onTranscriptChange, isConnected, settings }: AudioCaptureProps) {
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [audioSource, setAudioSource] = useState<AudioSource>('system')
  const [errorMsg, setErrorMsg] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [duration, setDuration] = useState(0)
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [autoSend, setAutoSend] = useState(false)
  const [autoSendInterval, setAutoSendInterval] = useState(30)
  const [isSavingTranscript, setIsSavingTranscript] = useState(false)
  const [streamDied, setStreamDied] = useState(false)

  // Speaker diarization (A/B/C) toggle + embedding model status
  const [diarize, setDiarize] = useState(false)
  const [embedStatus, setEmbedStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [embedProgress, setEmbedProgress] = useState(0)

  const autoSendRef = useRef(false)
  const autoSendIntervalRef = useRef(30)
  const autoSendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAutoSentRef = useRef('')
  const onTranscriptionRef = useRef(onTranscription)
  const restartingRef = useRef(false)
  const audioSourceRef = useRef<AudioSource>('system')
  const diarizeRef = useRef(false)
  const embedReadyRef = useRef(false)

  // Online speaker clustering state (system audio only)
  const speakerCentroidsRef = useRef<{ label: string; centroid: number[]; count: number }[]>([])
  const speakerThresholdRef = useRef(settings.speakerThreshold ?? DEFAULT_SPEAKER_THRESHOLD)

  const streamsRef = useRef<MediaStream[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorsRef = useRef<ScriptProcessorNode[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isListeningRef = useRef(false)
  // Separate PCM buffers per channel so we can attribute speech to mic vs system
  const micChunksRef = useRef<Float32Array[]>([])
  const systemChunksRef = useRef<Float32Array[]>([])
  const transcribeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTranscriptRef = useRef('')
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const { status: whisperStatus, progress, progressMessage, error: whisperError, loadModel, transcribe } = useWhisper()

  // Derived plain-text transcript (with speaker labels) for consumers
  const transcriptText = formatSegments(segments)

  // Load Whisper model on mount
  useEffect(() => {
    if (whisperStatus === 'idle') {
      loadModel()
    }
  }, [whisperStatus, loadModel])

  // Keep onTranscription ref in sync to avoid stale closures in timers
  useEffect(() => {
    onTranscriptionRef.current = onTranscription
  }, [onTranscription])

  // Keep audioSource ref in sync for auto-restart
  useEffect(() => {
    audioSourceRef.current = audioSource
  }, [audioSource])

  // Keep diarize ref in sync (read inside interval callbacks)
  useEffect(() => {
    diarizeRef.current = diarize
  }, [diarize])

  // Keep speaker-threshold ref in sync so Settings changes take effect live
  useEffect(() => {
    speakerThresholdRef.current = settings.speakerThreshold ?? DEFAULT_SPEAKER_THRESHOLD
  }, [settings.speakerThreshold])

  // Keep last transcript + notify parent when transcript changes
  useEffect(() => {
    lastTranscriptRef.current = transcriptText
    onTranscriptChange?.(transcriptText)
  }, [transcriptText, onTranscriptChange])

  // Speaker-embedding model: listen for load progress
  useEffect(() => {
    const cleanup = window.ghostAPI.onEmbedProgress((data) => {
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
    return cleanup
  }, [])

  // Keep embedReady ref in sync
  useEffect(() => {
    embedReadyRef.current = embedStatus === 'ready'
  }, [embedStatus])

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
    if (diarize && embedStatus === 'idle') {
      loadEmbed()
    }
  }, [diarize, embedStatus, loadEmbed])

  // Auto-scroll the transcript box to the bottom as new text arrives,
  // unless the user has scrolled up to read earlier content.
  useEffect(() => {
    const el = transcriptScrollRef.current
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [segments])

  // Track whether the user is near the bottom so we know to keep following
  const handleTranscriptScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 16
  }, [])

  // Keep autoSend ref in sync + manage auto-send timer
  useEffect(() => {
    autoSendRef.current = autoSend
    if (autoSend && isListeningRef.current) {
      if (autoSendTimerRef.current) clearInterval(autoSendTimerRef.current)
      autoSendTimerRef.current = setInterval(() => {
        const text = lastTranscriptRef.current.trim()
        if (text && text !== lastAutoSentRef.current) {
          lastAutoSentRef.current = text
          onTranscriptionRef.current(text)
        }
      }, autoSendIntervalRef.current * 1000)
    } else {
      if (autoSendTimerRef.current) {
        clearInterval(autoSendTimerRef.current)
        autoSendTimerRef.current = null
      }
    }
    return () => {
      if (autoSendTimerRef.current) {
        clearInterval(autoSendTimerRef.current)
        autoSendTimerRef.current = null
      }
    }
  }, [autoSend])

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopCapture() }
  }, [])

  const stopCapture = useCallback(() => {
    isListeningRef.current = false
    if (transcribeIntervalRef.current) {
      clearInterval(transcribeIntervalRef.current)
      transcribeIntervalRef.current = null
    }
    if (autoSendTimerRef.current) {
      clearInterval(autoSendTimerRef.current)
      autoSendTimerRef.current = null
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
    for (const p of processorsRef.current) {
      try { p.disconnect() } catch {}
    }
    processorsRef.current = []
    if (audioContextRef.current) {
      try { audioContextRef.current.close() } catch {}
      audioContextRef.current = null
    }
    for (const stream of streamsRef.current) {
      stream.getTracks().forEach(t => t.stop())
    }
    streamsRef.current = []
  }, [])

  // Assign a speaker label (A/B/C...) to a system-audio embedding via online
  // cosine-similarity clustering. Falls back to 'Other' if no embedding.
  const assignSpeaker = useCallback((embedding: number[] | null): string => {
    if (!embedding) return 'Other'
    const centroids = speakerCentroidsRef.current
    let best = -1
    let bestSim = -2
    for (let i = 0; i < centroids.length; i++) {
      const sim = dot(embedding, centroids[i].centroid)
      if (sim > bestSim) { bestSim = sim; best = i }
    }
    if (best >= 0 && bestSim >= speakerThresholdRef.current) {
      const c = centroids[best]
      const n = c.count
      const merged = c.centroid.map((v, j) => (v * n + embedding[j]) / (n + 1))
      let norm = 0
      for (const v of merged) norm += v * v
      norm = Math.sqrt(norm) || 1
      c.centroid = merged.map(v => v / norm)
      c.count = n + 1
      return c.label
    }
    const label = String.fromCharCode(65 + centroids.length) // A, B, C, ...
    centroids.push({ label, centroid: embedding.slice(), count: 1 })
    return label
  }, [])

  // Append a transcribed piece under a speaker label, merging consecutive
  // pieces from the same speaker into one paragraph.
  const appendSegment = useCallback((speaker: string, text: string) => {
    setSegments(prev => {
      const last = prev[prev.length - 1]
      if (last && last.speaker === speaker) {
        const updated = prev.slice()
        updated[updated.length - 1] = { ...last, text: `${last.text} ${text}`.trim() }
        return updated
      }
      return [...prev, { speaker, text }]
    })
  }, [])

  // Transcribe one channel's accumulated PCM and attribute it to a speaker.
  const transcribeChannel = useCallback(async (chunksRef: React.MutableRefObject<Float32Array[]>, channel: Channel) => {
    const chunks = chunksRef.current
    if (chunks.length === 0) return

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
    if (totalLength < 8000) return

    const combined = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    chunksRef.current = []

    if (!hasAudioEnergy(combined)) return

    const sampleRate = audioContextRef.current?.sampleRate || 48000
    const resampled = await resampleTo16kHz(combined, sampleRate)
    const text = await transcribe(resampled)
    if (!text || text.length === 0 || isHallucination(text)) return

    // Decide the speaker label
    let speaker = ''
    if (diarizeRef.current) {
      if (channel === 'mic') {
        speaker = 'You'
      } else {
        // System audio → fingerprint + cluster into A/B/C (or 'Other' if model not ready)
        let embedding: number[] | null = null
        if (embedReadyRef.current) {
          try {
            const res = await window.ghostAPI.embedSpeaker(resampled.buffer as ArrayBuffer)
            if (res.success && res.embedding) embedding = res.embedding
          } catch { /* ignore embedding failures */ }
        }
        speaker = assignSpeaker(embedding)
      }
    }

    appendSegment(speaker, text)
  }, [transcribe, assignSpeaker, appendSegment])

  // Run a transcription pass over whichever channels have audio
  const runTranscription = useCallback(async () => {
    if (isTranscribing) return
    if (micChunksRef.current.length === 0 && systemChunksRef.current.length === 0) return
    setIsTranscribing(true)
    try {
      // System first so its embedding call doesn't delay the (cheaper) mic text
      await transcribeChannel(systemChunksRef, 'system')
      await transcribeChannel(micChunksRef, 'mic')
    } catch (err: any) {
      console.error('Transcription error:', err)
    } finally {
      setIsTranscribing(false)
    }
  }, [isTranscribing, transcribeChannel])

  // Wire a single stream into the audio graph, capturing its PCM into the
  // channel-specific buffer and feeding the shared level-meter analyser.
  const wireStream = useCallback((stream: MediaStream, channel: Channel, audioContext: AudioContext, analyser: AnalyserNode) => {
    const src = audioContext.createMediaStreamSource(stream)
    src.connect(analyser)

    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (e) => {
      if (!isListeningRef.current) return
      const inputData = e.inputBuffer.getChannelData(0)
      const buf = channel === 'mic' ? micChunksRef : systemChunksRef
      buf.current.push(new Float32Array(inputData))
    }
    src.connect(processor)
    processor.connect(audioContext.destination)
    processorsRef.current.push(processor)

    // Detect when macOS kills the audio stream (ScreenCaptureKit timeout ~20 min)
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        console.warn('[AudioCapture] Audio track ended (OS killed stream)')
        if (isListeningRef.current) setStreamDied(true)
      }
    }
  }, [])

  // Build the full capture graph for the selected source (used by start + restart)
  const buildGraph = useCallback((streams: { stream: MediaStream; channel: Channel }[]) => {
    const audioContext = new AudioContext()
    audioContextRef.current = audioContext

    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256

    for (const { stream, channel } of streams) {
      wireStream(stream, channel, audioContext, analyser)
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

    // Transcribe at configured interval
    transcribeIntervalRef.current = setInterval(() => {
      runTranscription()
    }, (settings.transcriptionInterval || 10) * 1000)
  }, [wireStream, runTranscription, settings.transcriptionInterval])

  // Auto-restart when stream dies (macOS ScreenCaptureKit timeout ~20 min)
  useEffect(() => {
    if (!streamDied || restartingRef.current) return

    const restartCapture = async () => {
      restartingRef.current = true
      console.log('[AudioCapture] Stream died, auto-restarting...')

      stopCapture()
      setStreamDied(false)
      setStatus('requesting')
      setErrorMsg('')

      try {
        const source = audioSourceRef.current
        const streams: { stream: MediaStream; channel: Channel }[] = []
        if (source === 'mic' || source === 'both') {
          streams.push({ stream: await getMicStream(), channel: 'mic' })
        }
        if (source === 'system' || source === 'both') {
          streams.push({ stream: await getSystemStream(), channel: 'system' })
        }

        streamsRef.current = streams.map(s => s.stream)
        isListeningRef.current = true
        setStatus('listening')
        micChunksRef.current = []
        systemChunksRef.current = []

        buildGraph(streams)

        // Restart duration timer (continue from current duration, don't reset)
        durationIntervalRef.current = setInterval(() => {
          setDuration(d => d + 1)
        }, 1000)

        // Restart auto-send timer if it was active
        if (autoSendRef.current) {
          autoSendTimerRef.current = setInterval(() => {
            const text = lastTranscriptRef.current.trim()
            if (text && text !== lastAutoSentRef.current) {
              lastAutoSentRef.current = text
              onTranscriptionRef.current(text)
            }
          }, autoSendIntervalRef.current * 1000)
        }

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
  }, [streamDied, stopCapture, buildGraph])

  // Keep autoSendInterval ref in sync and restart auto-send timer if active
  useEffect(() => {
    autoSendIntervalRef.current = autoSendInterval
    if (autoSendRef.current && autoSendTimerRef.current) {
      clearInterval(autoSendTimerRef.current)
      autoSendTimerRef.current = setInterval(() => {
        const text = lastTranscriptRef.current.trim()
        if (text && text !== lastAutoSentRef.current) {
          lastAutoSentRef.current = text
          onTranscriptionRef.current(text)
        }
      }, autoSendInterval * 1000)
    }
  }, [autoSendInterval])

  // Get microphone stream
  const getMicStream = async (): Promise<MediaStream> => {
    try {
      const perm = await window.ghostAPI.requestMicPermission()
      if (!perm.granted) {
        throw new Error('Microphone permission denied. Enable in System Settings > Privacy > Microphone.')
      }
    } catch {}

    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  }

  // Get system audio stream via getDisplayMedia + loopback
  const getSystemStream = async (): Promise<MediaStream> => {
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

  const startCapture = useCallback(async () => {
    if (whisperStatus !== 'ready') {
      setErrorMsg('Whisper still loading. Please wait...')
      return
    }

    setErrorMsg('')
    setStatus('requesting')

    try {
      const streams: { stream: MediaStream; channel: Channel }[] = []
      if (audioSource === 'mic' || audioSource === 'both') {
        streams.push({ stream: await getMicStream(), channel: 'mic' })
      }
      if (audioSource === 'system' || audioSource === 'both') {
        streams.push({ stream: await getSystemStream(), channel: 'system' })
      }

      streamsRef.current = streams.map(s => s.stream)
      isListeningRef.current = true
      setStatus('listening')
      setDuration(0)
      setSegments([])
      speakerCentroidsRef.current = []
      micChunksRef.current = []
      systemChunksRef.current = []

      buildGraph(streams)

      durationIntervalRef.current = setInterval(() => {
        setDuration(d => d + 1)
      }, 1000)
    } catch (err: any) {
      setStatus('error')
      if (err.name === 'NotAllowedError') {
        setErrorMsg(
          audioSource === 'mic'
            ? 'Microphone permission denied.'
            : 'Screen recording permission denied. Enable in System Settings > Privacy > Screen Recording.'
        )
      } else if (err.name === 'NotFoundError') {
        setErrorMsg('No audio device found.')
      } else {
        setErrorMsg(err.message || `Error: ${err}`)
      }
    }
  }, [whisperStatus, audioSource, buildGraph])

  const handleStop = useCallback(async () => {
    stopCapture()
    if (micChunksRef.current.length > 0 || systemChunksRef.current.length > 0) {
      await runTranscription()
    }
    setStatus('idle')
    setAudioLevel(0)
    setDuration(0)
  }, [stopCapture, runTranscription])

  const handleSendTranscript = useCallback(() => {
    if (!transcriptText.trim()) return
    onTranscription(transcriptText.trim())
  }, [transcriptText, onTranscription])

  const handleSummarizeTranscript = useCallback(() => {
    if (!transcriptText.trim()) return
    onSummarize(transcriptText.trim())
  }, [transcriptText, onSummarize])

  const handleTranslateTranscript = useCallback(() => {
    if (!transcriptText.trim()) return
    onTranslate(transcriptText.trim())
  }, [transcriptText, onTranslate])

  const handleClearTranscript = useCallback(() => {
    setSegments([])
    speakerCentroidsRef.current = []
    lastTranscriptRef.current = ''
  }, [])

  const handleSaveTranscript = useCallback(async () => {
    if (!transcriptText.trim() || isSavingTranscript) return

    setIsSavingTranscript(true)
    try {
      const now = new Date()
      const dateStr = now.toISOString().slice(0, 10)
      const timeStr = now.toTimeString().slice(0, 5).replace(':', 'h')

      const content = `Audio Transcription\nDate: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${timeStr}\nSource: ${audioSource === 'mic' ? 'Microphone' : audioSource === 'system' ? 'System Audio' : 'Mic + System'}\n\n${'='.repeat(50)}\n\n${transcriptText.trim()}\n`

      let suggestedName = `transcription_${dateStr}_${timeStr}`

      if (isConnected) {
        try {
          const result = await window.ghostAPI.ollamaChat({
            model: settings.selectedModel,
            baseUrl: settings.ollamaBaseUrl,
            messages: [
              {
                role: 'system',
                content: 'Generate a very short filename (2-4 words, no spaces use underscores, lowercase, no extension, no special chars, english) that describes the topic of this transcription. Reply with ONLY the filename, nothing else.',
              },
              { role: 'user', content: transcriptText.trim().slice(0, 500) },
            ],
          })

          if (result.success && result.message?.content) {
            const aiName = result.message.content
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, '_')
              .replace(/_+/g, '_')
              .replace(/^_|_$/g, '')
              .slice(0, 40)

            if (aiName.length > 2) {
              suggestedName = `transcript_${aiName}_${dateStr}`
            }
          }
        } catch {}
      }

      await window.ghostAPI.saveConversation({
        content,
        suggestedName: `${suggestedName}.txt`,
      })
    } finally {
      setIsSavingTranscript(false)
    }
  }, [transcriptText, audioSource, isConnected, settings, isSavingTranscript])

  const fmtDuration = (s: number) => {
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, '0')}`
  }

  const whisperReady = whisperStatus === 'ready'
  const whisperLoading = whisperStatus === 'loading'
  const hasTranscript = segments.length > 0

  const sourceLabels: Record<AudioSource, string> = {
    mic: 'Mic',
    system: 'System',
    both: 'Both',
  }

  const sourceIcons: Record<AudioSource, string> = {
    mic: 'Your microphone',
    system: 'Audio from meetings/videos',
    both: 'Mic + system together',
  }

  return (
    <div className="space-y-1.5">
      {/* Whisper model loading progress */}
      {whisperLoading && (
        <div className="space-y-1 animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ghost-accent animate-pulse" />
            <span className="text-[9px] text-ghost-text-muted">{progressMessage}</span>
          </div>
          <div className="w-full bg-ghost-fill rounded-full h-1 overflow-hidden">
            {progress > 0 ? (
              <div
                className="bg-ghost-accent h-1 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            ) : (
              <div className="bg-ghost-accent h-1 rounded-full w-1/3 animate-indeterminate" />
            )}
          </div>
        </div>
      )}

      {/* Whisper error */}
      {whisperStatus === 'error' && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-ghost-error">Whisper: {whisperError}</span>
          <button onClick={loadModel} className="text-[9px] text-ghost-accent hover:underline">
            Retry
          </button>
        </div>
      )}

      {/* Speaker model loading progress */}
      {diarize && embedStatus === 'loading' && (
        <div className="space-y-1 animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ghost-accent animate-pulse" />
            <span className="text-[9px] text-ghost-text-muted">Loading speaker model... {embedProgress > 0 ? `${embedProgress}%` : ''}</span>
          </div>
          <div className="w-full bg-ghost-fill rounded-full h-1 overflow-hidden">
            {embedProgress > 0 ? (
              <div className="bg-ghost-accent h-1 rounded-full transition-all duration-300" style={{ width: `${embedProgress}%` }} />
            ) : (
              <div className="bg-ghost-accent h-1 rounded-full w-1/3 animate-indeterminate" />
            )}
          </div>
        </div>
      )}
      {diarize && embedStatus === 'error' && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-ghost-warning">Speaker model failed to load. Falling back to You/Other.</span>
          <button onClick={loadEmbed} className="text-[9px] text-ghost-accent hover:underline">Retry</button>
        </div>
      )}

      {/* Source selector + main controls */}
      <div className="flex items-center gap-2">
        {/* Audio source toggle (only when idle) — macOS segmented control style */}
        {status === 'idle' && whisperReady && (
          <div className="flex gap-0.5 p-0.5 rounded-lg bg-ghost-fill">
            {(['mic', 'system', 'both'] as AudioSource[]).map((src) => (
              <button
                key={src}
                onClick={() => setAudioSource(src)}
                className={`px-2 py-0.5 text-[9px] rounded-md transition-all ${
                  audioSource === src
                    ? 'bg-ghost-surface text-ghost-text shadow-sm font-medium'
                    : 'text-ghost-text-muted hover:text-ghost-text'
                }`}
                title={sourceIcons[src]}
              >
                {sourceLabels[src]}
              </button>
            ))}
          </div>
        )}

        {/* Speakers (diarization) toggle */}
        {whisperReady && (status === 'idle' || status === 'listening') && (
          <button
            onClick={() => setDiarize(d => !d)}
            className={`px-1.5 py-0.5 rounded-md text-[8px] transition-colors ${
              diarize ? 'bg-ghost-accent/20 text-ghost-accent' : 'bg-ghost-fill text-ghost-text-muted hover:text-ghost-text'
            }`}
            title="Separate speakers (You / A / B / C). Labels the other side of the call by voice."
          >
            Speakers
          </button>
        )}

        {/* Record button */}
        <button
          onClick={status === 'listening' ? handleStop : startCapture}
          disabled={!isConnected || !whisperReady || status === 'requesting'}
          className={`relative p-1.5 rounded-lg transition-all duration-200 ${
            status === 'listening'
              ? 'bg-ghost-error/30 hover:bg-ghost-error/40 ring-2 ring-ghost-error/50'
              : status === 'error'
                ? 'bg-ghost-warning/20 hover:bg-ghost-warning/30'
                : whisperReady
                  ? 'bg-ghost-fill hover:bg-ghost-fill-strong'
                  : 'bg-ghost-fill opacity-30'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
          title={
            !whisperReady ? 'Waiting for Whisper...'
              : status === 'listening' ? 'Stop'
              : `Transcribe: ${sourceIcons[audioSource]}`
          }
        >
          {status === 'listening' && (
            <div
              className="absolute inset-0 rounded-lg border-2 border-ghost-error/50 transition-transform duration-75"
              style={{
                transform: `scale(${1 + audioLevel * 0.3})`,
                opacity: 0.3 + audioLevel * 0.7,
              }}
            />
          )}
          {audioSource === 'system' ? (
            <svg className={`w-3.5 h-3.5 ${
              status === 'listening' ? 'text-ghost-error' : status === 'error' ? 'text-ghost-warning' : whisperReady ? 'text-ghost-text-muted' : 'text-ghost-text-muted/30'
            }`} fill={status === 'listening' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              />
            </svg>
          ) : (
            <svg className={`w-3.5 h-3.5 ${
              status === 'listening' ? 'text-ghost-error' : status === 'error' ? 'text-ghost-warning' : whisperReady ? 'text-ghost-text-muted' : 'text-ghost-text-muted/30'
            }`} fill={status === 'listening' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          )}
        </button>

        {/* Status */}
        {status === 'listening' && (
          <>
            <span className="text-[9px] text-ghost-error font-mono tabular-nums">
              {fmtDuration(duration)}
            </span>
            <div className="flex items-end gap-px h-3">
              {[0.15, 0.3, 0.5, 0.7, 0.85].map((t, i) => (
                <div key={i}
                  className={`w-0.5 rounded-full transition-all duration-75 ${audioLevel > t ? 'bg-ghost-error' : 'bg-ghost-fill-strong'}`}
                  style={{ height: `${40 + i * 15}%` }}
                />
              ))}
            </div>
            {streamDied ? (
              <span className="text-[9px] text-ghost-warning animate-pulse">Reconnecting audio...</span>
            ) : isTranscribing ? (
              <span className="text-[9px] text-ghost-accent animate-pulse">Transcribing...</span>
            ) : (
              <span className="text-[9px] text-ghost-text-muted">
                {audioSource === 'mic' ? 'Mic' : audioSource === 'system' ? 'System' : 'Mic+System'}
              </span>
            )}
          </>
        )}

        {status === 'error' && errorMsg && (
          <span className="text-[9px] text-ghost-warning truncate flex-1">{errorMsg}</span>
        )}

        {status === 'requesting' && (
          <span className="text-[9px] text-ghost-text-muted animate-pulse">Requesting access...</span>
        )}

        {status === 'idle' && whisperReady && (
          <span className="text-[9px] text-ghost-text-muted opacity-50 truncate">
            {sourceIcons[audioSource]}
          </span>
        )}

        {/* Auto-send toggle + interval control */}
        {status === 'listening' && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setAutoSend(a => !a)}
              className={`px-1.5 py-0.5 rounded text-[8px] transition-colors ${
                autoSend ? 'bg-ghost-accent/20 text-ghost-accent' : 'bg-ghost-fill text-ghost-text-muted'
              }`}
              title="Automatically send transcription to Ollama at the configured interval"
            >
              Auto
            </button>
            {autoSend && (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setAutoSendInterval(v => Math.max(10, v - 5))}
                  className="w-4 h-4 flex items-center justify-center rounded text-[9px] bg-ghost-fill text-ghost-text-muted hover:bg-ghost-fill-strong transition-colors"
                  title="Decrease auto-send interval"
                >
                  -
                </button>
                <span className="text-[8px] text-ghost-text-muted w-5 text-center" title="Interval between automatic sends to Ollama (seconds)">
                  {autoSendInterval}s
                </span>
                <button
                  onClick={() => setAutoSendInterval(v => Math.min(120, v + 5))}
                  className="w-4 h-4 flex items-center justify-center rounded text-[9px] bg-ghost-fill text-ghost-text-muted hover:bg-ghost-fill-strong transition-colors"
                  title="Increase auto-send interval"
                >
                  +
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transcript display — drag the bottom edge to resize vertically */}
      {(hasTranscript || status === 'listening') && (
        <div className="space-y-1 animate-fade-in">
          <div
            ref={transcriptScrollRef}
            onScroll={handleTranscriptScroll}
            className="bg-ghost-fill border border-ghost-border rounded-lg px-2 py-1.5 overflow-y-auto resize-y h-24 min-h-[48px] max-h-[480px]"
            title="Drag the bottom edge to resize"
          >
            {hasTranscript ? (
              <div className="space-y-1">
                {segments.map((seg, i) => (
                  seg.speaker ? (
                    <p key={i} className="text-[10px] leading-relaxed">
                      <span className={`inline-block px-1 rounded text-[8px] font-medium mr-1 align-middle ${speakerChipClass(seg.speaker)}`}>
                        {seg.speaker}
                      </span>
                      <span className="text-ghost-text">{seg.text}</span>
                    </p>
                  ) : (
                    <p key={i} className="text-[10px] text-ghost-text leading-relaxed">{seg.text}</p>
                  )
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-ghost-text-muted/40 italic">
                Transcription will appear here...
              </p>
            )}
          </div>
          {hasTranscript && (
            <div className="flex gap-1">
              <button
                onClick={handleSendTranscript}
                disabled={!isConnected}
                className="px-2 py-0.5 rounded text-[9px] font-medium bg-ghost-accent/15 dark:bg-ghost-accent/25 text-ghost-accent hover:bg-ghost-accent/25 dark:hover:bg-ghost-accent/35 disabled:opacity-30 transition-colors"
              >
                Suggest reply
              </button>
              <button
                onClick={handleSummarizeTranscript}
                disabled={!isConnected}
                className="px-2 py-0.5 rounded text-[9px] font-medium bg-purple-500/15 dark:bg-purple-500/25 text-purple-700 dark:text-purple-300 hover:bg-purple-500/25 dark:hover:bg-purple-500/35 disabled:opacity-30 transition-colors"
              >
                Summarize
              </button>
              <button
                onClick={handleTranslateTranscript}
                disabled={!isConnected}
                className="px-2 py-0.5 rounded text-[9px] font-medium bg-blue-500/15 dark:bg-blue-500/25 text-blue-700 dark:text-blue-300 hover:bg-blue-500/25 dark:hover:bg-blue-500/35 disabled:opacity-30 transition-colors"
              >
                Translate PT
              </button>
              <button
                onClick={handleSaveTranscript}
                disabled={isSavingTranscript}
                className="px-2 py-0.5 rounded text-[9px] font-medium bg-green-500/15 dark:bg-green-500/25 text-green-700 dark:text-green-300 hover:bg-green-500/25 dark:hover:bg-green-500/35 disabled:opacity-30 transition-colors"
                title="Save transcription to .txt"
              >
                {isSavingTranscript ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleClearTranscript}
                className="px-2 py-0.5 rounded text-[9px] bg-ghost-fill text-ghost-text-muted hover:bg-ghost-fill-strong transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
