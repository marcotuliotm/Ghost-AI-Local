import { useState, useRef, useCallback, useEffect } from 'react'
import { useWhisper } from '../hooks/useWhisper'

interface AudioCaptureProps {
  onTranscription: (text: string) => void
  onSummarize: (text: string) => void
  onTranslate: (text: string) => void
  isConnected: boolean
  settings: { selectedModel: string; ollamaBaseUrl: string; transcriptionInterval: number }
}

type CaptureStatus = 'idle' | 'requesting' | 'listening' | 'error'
type AudioSource = 'mic' | 'system' | 'both'

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
 * AudioCapture - 100% local audio transcription.
 *
 * Supports three audio sources:
 * - Mic: your microphone (what you say)
 * - System: desktop audio (meetings, videos, calls)
 * - Both: mic + system audio mixed together
 *
 * Flow: Audio source → Raw PCM → Whisper (main process) → Text → Ollama
 */
export function AudioCapture({ onTranscription, onSummarize, onTranslate, isConnected, settings }: AudioCaptureProps) {
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [audioSource, setAudioSource] = useState<AudioSource>('system')
  const [errorMsg, setErrorMsg] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [duration, setDuration] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [autoSend, setAutoSend] = useState(false)
  const [isSavingTranscript, setIsSavingTranscript] = useState(false)
  const autoSendRef = useRef(false)

  const streamsRef = useRef<MediaStream[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isListeningRef = useRef(false)
  const audioChunksRef = useRef<Float32Array[]>([])
  const transcribeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTranscriptRef = useRef('')

  const { status: whisperStatus, progress, progressMessage, error: whisperError, loadModel, transcribe } = useWhisper()

  // Load Whisper model on mount
  useEffect(() => {
    if (whisperStatus === 'idle') {
      loadModel()
    }
  }, [whisperStatus, loadModel])

  // Keep autoSend ref in sync
  useEffect(() => {
    autoSendRef.current = autoSend
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
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close() } catch {}
      audioContextRef.current = null
    }
    for (const stream of streamsRef.current) {
      stream.getTracks().forEach(t => t.stop())
    }
    streamsRef.current = []
  }, [])

  const transcribeChunks = useCallback(async () => {
    if (audioChunksRef.current.length === 0) return
    if (isTranscribing) return

    const totalLength = audioChunksRef.current.reduce((acc, chunk) => acc + chunk.length, 0)
    if (totalLength < 8000) return

    const combined = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of audioChunksRef.current) {
      combined.set(chunk, offset)
      offset += chunk.length
    }
    audioChunksRef.current = []

    if (!hasAudioEnergy(combined)) return

    setIsTranscribing(true)
    try {
      const sampleRate = audioContextRef.current?.sampleRate || 48000
      const resampled = await resampleTo16kHz(combined, sampleRate)
      const text = await transcribe(resampled)

      if (text && text.length > 0 && !isHallucination(text)) {
        setTranscript(prev => {
          const updated = prev ? `${prev} ${text}` : text
          lastTranscriptRef.current = updated
          return updated
        })
        if (autoSendRef.current && text.trim()) {
          onTranscription(text.trim())
        }
      }
    } catch (err: any) {
      console.error('Transcription error:', err)
    } finally {
      setIsTranscribing(false)
    }
  }, [transcribe, isTranscribing, onTranscription])

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

    // Stop the video track immediately - we only need audio
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
      const streams: MediaStream[] = []

      // Get streams based on selected source
      if (audioSource === 'mic' || audioSource === 'both') {
        streams.push(await getMicStream())
      }
      if (audioSource === 'system' || audioSource === 'both') {
        streams.push(await getSystemStream())
      }

      streamsRef.current = streams
      isListeningRef.current = true
      setStatus('listening')
      setDuration(0)
      setTranscript('')
      audioChunksRef.current = []

      // Create audio context and mix all streams together
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      // Merger: combine all audio sources into one
      const merger = audioContext.createChannelMerger(1)

      // Analyser for level visualization
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256

      for (const stream of streams) {
        const source = audioContext.createMediaStreamSource(stream)
        source.connect(merger)
        source.connect(analyser)
      }

      // ScriptProcessor to capture raw PCM from merged audio
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        if (!isListeningRef.current) return
        const inputData = e.inputBuffer.getChannelData(0)
        audioChunksRef.current.push(new Float32Array(inputData))
      }

      merger.connect(processor)
      processor.connect(audioContext.destination)

      // Audio level visualization
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateLevel = () => {
        if (!isListeningRef.current) return
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        setAudioLevel(avg / 255)
        animationFrameRef.current = requestAnimationFrame(updateLevel)
      }
      updateLevel()

      // Duration timer
      durationIntervalRef.current = setInterval(() => {
        setDuration(d => d + 1)
      }, 1000)

      // Transcribe at configured interval
      transcribeIntervalRef.current = setInterval(() => {
        transcribeChunks()
      }, (settings.transcriptionInterval || 10) * 1000)

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
  }, [whisperStatus, audioSource, transcribeChunks])

  const handleStop = useCallback(async () => {
    stopCapture()
    if (audioChunksRef.current.length > 0) {
      await transcribeChunks()
    }
    setStatus('idle')
    setAudioLevel(0)
    setDuration(0)
  }, [stopCapture, transcribeChunks])

  const handleSendTranscript = useCallback(() => {
    if (!transcript.trim()) return
    onTranscription(transcript.trim())
    setTranscript('')
  }, [transcript, onTranscription])

  const handleSummarizeTranscript = useCallback(() => {
    if (!transcript.trim()) return
    onSummarize(transcript.trim())
  }, [transcript, onSummarize])

  const handleTranslateTranscript = useCallback(() => {
    if (!transcript.trim()) return
    onTranslate(transcript.trim())
  }, [transcript, onTranslate])

  const handleClearTranscript = useCallback(() => {
    setTranscript('')
    lastTranscriptRef.current = ''
  }, [])

  const handleSaveTranscript = useCallback(async () => {
    if (!transcript.trim() || isSavingTranscript) return

    setIsSavingTranscript(true)
    try {
      const now = new Date()
      const dateStr = now.toISOString().slice(0, 10)
      const timeStr = now.toTimeString().slice(0, 5).replace(':', 'h')

      const content = `Audio Transcription\nDate: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${timeStr}\nSource: ${audioSource === 'mic' ? 'Microphone' : audioSource === 'system' ? 'System Audio' : 'Mic + System'}\n\n${'='.repeat(50)}\n\n${transcript.trim()}\n`

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
              { role: 'user', content: transcript.trim().slice(0, 500) },
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
  }, [transcript, audioSource, isConnected, settings, isSavingTranscript])

  const fmtDuration = (s: number) => {
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, '0')}`
  }

  const whisperReady = whisperStatus === 'ready'
  const whisperLoading = whisperStatus === 'loading'

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
          <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
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

      {/* Source selector + main controls */}
      <div className="flex items-center gap-2">
        {/* Audio source toggle (only when idle) */}
        {status === 'idle' && whisperReady && (
          <div className="flex rounded-lg overflow-hidden border border-ghost-border">
            {(['mic', 'system', 'both'] as AudioSource[]).map((src) => (
              <button
                key={src}
                onClick={() => setAudioSource(src)}
                className={`px-1.5 py-0.5 text-[8px] transition-colors ${
                  audioSource === src
                    ? 'bg-ghost-accent/20 text-ghost-accent'
                    : 'bg-white/5 text-ghost-text-muted hover:bg-white/10'
                }`}
                title={sourceIcons[src]}
              >
                {sourceLabels[src]}
              </button>
            ))}
          </div>
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
                  ? 'bg-white/5 hover:bg-white/10'
                  : 'bg-white/5 opacity-30'
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
          {/* Mic icon for mic, speaker icon for system, both for both */}
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
                  className={`w-0.5 rounded-full transition-all duration-75 ${audioLevel > t ? 'bg-ghost-error' : 'bg-white/10'}`}
                  style={{ height: `${40 + i * 15}%` }}
                />
              ))}
            </div>
            {isTranscribing ? (
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
          <span className="text-[9px] text-ghost-text-muted opacity-50">
            {sourceIcons[audioSource]}
          </span>
        )}

        {/* Auto-send toggle */}
        {status === 'listening' && (
          <button
            onClick={() => setAutoSend(a => !a)}
            className={`ml-auto px-1.5 py-0.5 rounded text-[8px] transition-colors ${
              autoSend ? 'bg-ghost-accent/20 text-ghost-accent' : 'bg-white/5 text-ghost-text-muted'
            }`}
            title="Automatically send each transcribed chunk for suggestions"
          >
            Auto
          </button>
        )}
      </div>

      {/* Transcript display */}
      {(transcript || status === 'listening') && (
        <div className="space-y-1 animate-fade-in">
          <div className="bg-white/5 border border-ghost-border rounded-lg px-2 py-1.5 max-h-24 overflow-y-auto">
            {transcript ? (
              <p className="text-[10px] text-ghost-text leading-relaxed">{transcript}</p>
            ) : (
              <p className="text-[10px] text-ghost-text-muted/40 italic">
                Transcription will appear here...
              </p>
            )}
          </div>
          {transcript && (
            <div className="flex gap-1">
              <button
                onClick={handleSendTranscript}
                disabled={!isConnected}
                className="px-2 py-0.5 rounded text-[9px] bg-ghost-accent/20 text-ghost-accent hover:bg-ghost-accent/30 disabled:opacity-30 transition-colors"
              >
                Suggest reply
              </button>
              <button
                onClick={handleSummarizeTranscript}
                disabled={!isConnected}
                className="px-2 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-30 transition-colors"
              >
                Summarize
              </button>
              <button
                onClick={handleTranslateTranscript}
                disabled={!isConnected}
                className="px-2 py-0.5 rounded text-[9px] bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-30 transition-colors"
              >
                Translate PT
              </button>
              <button
                onClick={handleSaveTranscript}
                disabled={isSavingTranscript}
                className="px-2 py-0.5 rounded text-[9px] bg-ghost-success/20 text-ghost-success hover:bg-ghost-success/30 disabled:opacity-30 transition-colors"
                title="Save transcription to .txt"
              >
                {isSavingTranscript ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleClearTranscript}
                className="px-2 py-0.5 rounded text-[9px] bg-white/5 text-ghost-text-muted hover:bg-white/10 transition-colors"
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
