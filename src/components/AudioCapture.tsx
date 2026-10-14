import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useWhisper } from '../hooks/useWhisper'
import { useAudioGraph, type AudioSource } from '../hooks/useAudioGraph'
import { useTranscriptionQueue, type QueuedSegment } from '../hooks/useTranscriptionQueue'
import { useDiarization } from '../hooks/useDiarization'
import { useAutoSend } from '../hooks/useAutoSend'
import { hasAudioEnergy, isHallucination, resampleTo16kHz } from '../lib/audio'
import {
  appendToSegments,
  displaySpeaker,
  formatSegments,
  removeTrailingText,
  transcriptSpeakers,
  type SpeakerNames,
  type TranscriptSegment,
} from '../lib/transcript'
import { EchoFilter } from '../lib/echo'
import { isQuestion, QUESTION_COOLDOWN_MS } from '../lib/questions'
import { transcriptTail } from '../lib/context'
import { fileStamp, suggestFilename } from '../lib/filename'

interface AudioCaptureProps {
  // Return false to signal the text was not consumed (Auto mode will retry it).
  onTranscription: (text: string) => boolean | void
  // The parent sends the transcript itself as context
  onSummarize: () => void
  onSummarizePT: () => void
  // Generate meeting notes from the transcript (parent builds the request)
  onNotes?: () => void
  // Formatted transcript (custom speaker names applied) and its speakers
  onTranscriptChange?: (text: string, speakers: string[]) => void
  isConnected: boolean
  // False until persisted settings are loaded, so Whisper doesn't start
  // downloading the default model when another one was saved.
  canLoadWhisper?: boolean
  settings: {
    selectedModel: string
    ollamaBaseUrl: string
    transcriptionInterval: number
    speakerThreshold: number
    whisperModel?: string
    transcriptionLanguage?: string
  }
}

// Manual "Suggest reply" sends this much of the end of the transcript as the
// excerpt to answer (the full conversation goes along as context).
const SUGGEST_REPLY_TAIL_TOKENS = 300

// Speaker labels that can be renamed ("You" is the user, '' is unlabeled)
const isRenamable = (label: string) => label !== '' && label !== 'You'

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

/**
 * AudioCapture - 100% local audio transcription with speaker separation.
 *
 * Sources:
 * - Mic: your microphone (labeled "You")
 * - System: desktop audio (meetings/videos) — diarized into Speaker A/B/C
 * - Both: mic + system, captured on separate channels (mic echo of the
 *   speakers is filtered out)
 *
 * Pieces: useAudioGraph (streams → AudioWorklet → VAD segments, auto-restart)
 * → useTranscriptionQueue (serial) → Whisper (useWhisper) + useDiarization
 * (You / A / B / C) → labeled transcript. useAutoSend and the Questions mode
 * send excerpts to the parent for reply suggestions.
 */
export function AudioCapture({ onTranscription, onSummarize, onSummarizePT, onNotes, onTranscriptChange, isConnected, canLoadWhisper = true, settings }: AudioCaptureProps) {
  const [audioSource, setAudioSource] = useState<AudioSource>('system')
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [speakerNames, setSpeakerNames] = useState<SpeakerNames>({})
  // Speaker label being renamed (inline input) and its draft name
  const [renaming, setRenaming] = useState<{ label: string; draft: string } | null>(null)
  const [questionsMode, setQuestionsMode] = useState(false)
  const [isSavingTranscript, setIsSavingTranscript] = useState(false)
  // After Stop, offer to turn the transcript into meeting notes
  const [offerNotes, setOfferNotes] = useState(false)

  // Read inside the transcription queue (outside the render cycle)
  const segmentsRef = useRef<TranscriptSegment[]>([])
  const namesRef = useRef<SpeakerNames>({})
  namesRef.current = speakerNames
  const lastTranscriptRef = useRef('')
  const onTranscriptionRef = useRef(onTranscription)
  onTranscriptionRef.current = onTranscription
  const questionsRef = useRef(questionsMode)
  questionsRef.current = questionsMode
  const lastQuestionAtRef = useRef(0)
  const echoRef = useRef(new EchoFilter())
  const echoActiveRef = useRef(false)
  // The last mic text appended (retracted if system audio turns out to repeat it)
  const lastMicAppendRef = useRef<{ speaker: string; text: string } | null>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const {
    status: whisperStatus, progress, progressMessage, error: whisperError, needsReload, loadModel, transcribe,
  } = useWhisper(settings.whisperModel, settings.transcriptionLanguage)
  const diarization = useDiarization(settings.speakerThreshold)
  const { enabled: diarize, setEnabled: setDiarize, embedStatus, embedProgress, loadEmbed } = diarization

  // Derived plain-text transcript (speaker names applied) for consumers
  const transcriptText = useMemo(() => formatSegments(segments, speakerNames), [segments, speakerNames])
  const speakers = useMemo(() => transcriptSpeakers(segments, speakerNames), [segments, speakerNames])

  // Update the transcript synchronously in refs too, so the queue (and Auto)
  // see the latest text before React re-renders.
  const updateSegments = useCallback((fn: (segs: TranscriptSegment[]) => TranscriptSegment[]) => {
    const next = fn(segmentsRef.current)
    if (next === segmentsRef.current) return
    segmentsRef.current = next
    lastTranscriptRef.current = formatSegments(next, namesRef.current)
    setSegments(next)
  }, [])

  // Transcribe one closed speech segment and attribute it to a speaker.
  const processSegment = useCallback(async ({ channel, audio, sampleRate, endedAt }: QueuedSegment) => {
    if (!hasAudioEnergy(audio)) return

    const resampled = await resampleTo16kHz(audio, sampleRate)
    const text = await transcribe(resampled)
    if (!text || text.length === 0 || isHallucination(text)) return

    // Both mode without headphones: the mic also hears the speakers. Drop mic
    // text that repeats what system audio just said, and retract the last mic
    // text if system audio arrives with the same words afterwards.
    if (echoActiveRef.current) {
      const echo = echoRef.current
      if (channel === 'mic' && echo.match('system', text, endedAt)) return
      if (channel === 'system') {
        const micText = echo.match('mic', text, endedAt)
        const lastMic = lastMicAppendRef.current
        if (micText && lastMic && lastMic.text === micText) {
          updateSegments(segs => removeTrailingText(segs, lastMic.speaker, micText))
          echo.forget('mic', micText)
          lastMicAppendRef.current = null
        }
      }
      echo.record(channel, text, endedAt)
    }

    const speaker = await diarization.labelFor(channel, resampled)
    updateSegments(segs => appendToSegments(segs, speaker, text))
    lastMicAppendRef.current = channel === 'mic' ? { speaker, text } : null

    // Questions mode: answer as soon as the other side asks something
    const now = Date.now()
    if (channel === 'system' && questionsRef.current && isQuestion(text) && now - lastQuestionAtRef.current >= QUESTION_COOLDOWN_MS) {
      const label = speaker ? `${displaySpeaker(speaker, namesRef.current)}: ` : ''
      if (onTranscriptionRef.current(`${label}${text}`) !== false) {
        lastQuestionAtRef.current = now
        // Auto shouldn't send the same question again
        markAutoSent(lastTranscriptRef.current)
      }
    }
  }, [transcribe, diarization.labelFor, updateSegments])

  const queue = useTranscriptionQueue(processSegment)
  const graph = useAudioGraph({ onSegment: queue.enqueue, maxSegmentSeconds: settings.transcriptionInterval })
  const { status, errorMsg, setErrorMsg, audioLevel, duration, streamDied } = graph
  const isTranscribing = queue.isTranscribing

  const autoSend = useAutoSend(status === 'listening', () => lastTranscriptRef.current, delta => onTranscriptionRef.current(delta))
  const { enabled: autoSendOn, setEnabled: setAutoSend, intervalSec: autoSendInterval, changeInterval, markSent: markAutoSent } = autoSend

  // A model switch can't happen mid-recording: the pipeline in use would be
  // disposed. It is applied once capture stops (and the queue has drained).
  const isCapturing = status === 'listening' || status === 'requesting'

  // Load Whisper on mount, and reload when the model is changed in Settings
  useEffect(() => {
    if (!canLoadWhisper) return
    if (whisperStatus === 'idle' || (needsReload && !isCapturing)) {
      loadModel()
    }
  }, [canLoadWhisper, whisperStatus, needsReload, isCapturing, loadModel])

  // Notify parent when the transcript (or a speaker name) changes
  useEffect(() => {
    lastTranscriptRef.current = transcriptText
    onTranscriptChange?.(transcriptText, speakers)
  }, [transcriptText, speakers, onTranscriptChange])

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

  const resetTranscript = useCallback(() => {
    updateSegments(() => [])
    lastTranscriptRef.current = ''
    setSpeakerNames({})
    setRenaming(null)
    diarization.reset()
    echoRef.current.reset()
    lastMicAppendRef.current = null
  }, [updateSegments, diarization.reset])

  const startCapture = useCallback(async () => {
    if (whisperStatus !== 'ready') {
      setErrorMsg('Whisper still loading. Please wait...')
      return
    }
    await graph.start(audioSource, () => {
      echoActiveRef.current = audioSource === 'both'
      setOfferNotes(false)
      queue.clear()
      resetTranscript()
    })
  }, [whisperStatus, audioSource, graph.start, queue.clear, resetTranscript, setErrorMsg])

  const handleStop = useCallback(async () => {
    graph.stop()
    // Transcribe the phrase in progress plus anything still queued
    await queue.drain()
    graph.finish()
    if (lastTranscriptRef.current.trim()) setOfferNotes(true)
  }, [graph.stop, graph.finish, queue.drain])

  // Manual Suggest reply answers the most recent part of the conversation
  const handleSendTranscript = useCallback(() => {
    if (!transcriptText.trim()) return
    onTranscription(transcriptTail(transcriptText, SUGGEST_REPLY_TAIL_TOKENS))
  }, [transcriptText, onTranscription])

  const handleSummarizeTranscript = useCallback(() => {
    if (!transcriptText.trim()) return
    onSummarize()
  }, [transcriptText, onSummarize])

  const handleSummarizePTTranscript = useCallback(() => {
    if (!transcriptText.trim()) return
    onSummarizePT()
  }, [transcriptText, onSummarizePT])

  const handleNotes = useCallback(() => {
    if (!transcriptText.trim() || !onNotes) return
    setOfferNotes(false)
    onNotes()
  }, [transcriptText, onNotes])

  const handleClearTranscript = useCallback(() => {
    setOfferNotes(false)
    resetTranscript()
  }, [resetTranscript])

  // Rename a speaker (A → "Maria"); an empty name restores the label
  const commitRename = useCallback(() => {
    if (!renaming) return
    const name = renaming.draft.trim().replace(/[:\n]/g, ' ').trim().slice(0, 40)
    setSpeakerNames(prev => {
      const next = { ...prev }
      if (name && name !== renaming.label) next[renaming.label] = name
      else delete next[renaming.label]
      return next
    })
    setRenaming(null)
  }, [renaming])

  const handleSaveTranscript = useCallback(async () => {
    if (!transcriptText.trim() || isSavingTranscript) return

    setIsSavingTranscript(true)
    try {
      const now = new Date()
      const { date: dateStr, time: timeStr } = fileStamp(now)

      const content = `Audio Transcription\nDate: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${timeStr}\nSource: ${audioSource === 'mic' ? 'Microphone' : audioSource === 'system' ? 'System Audio' : 'Mic + System'}\n\n${'='.repeat(50)}\n\n${transcriptText.trim()}\n`

      let suggestedName = `transcription_${dateStr}_${timeStr}`
      if (isConnected) {
        const aiName = await suggestFilename(settings, transcriptText.trim().slice(0, 500), 'transcription')
        if (aiName) suggestedName = `transcript_${aiName}_${dateStr}`
      }

      await window.ghostAPI.saveConversation({
        content,
        suggestedName: `${suggestedName}.txt`,
        format: 'txt',
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
  const hearsOtherSide = audioSource !== 'mic'

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

      {/* Model changed in Settings while recording */}
      {needsReload && isCapturing && (
        <div className="text-[9px] text-ghost-warning">
          The new Whisper model will load when you stop recording.
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

        {/* Questions + Auto-send toggles and interval control */}
        {status === 'listening' && (
          <div className="ml-auto flex items-center gap-1">
            {hearsOtherSide && (
              <button
                onClick={() => setQuestionsMode(q => !q)}
                className={`px-1.5 py-0.5 rounded text-[8px] transition-colors ${
                  questionsMode ? 'bg-ghost-accent/20 text-ghost-accent' : 'bg-ghost-fill text-ghost-text-muted'
                }`}
                title="Suggest a reply as soon as the other side asks a question"
              >
                Questions
              </button>
            )}
            <button
              onClick={() => setAutoSend(a => !a)}
              className={`px-1.5 py-0.5 rounded text-[8px] transition-colors ${
                autoSendOn ? 'bg-ghost-accent/20 text-ghost-accent' : 'bg-ghost-fill text-ghost-text-muted'
              }`}
              title="Automatically send transcription to Ollama at the configured interval"
            >
              Auto
            </button>
            {autoSendOn && (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => changeInterval(-5)}
                  className="w-4 h-4 flex items-center justify-center rounded text-[9px] bg-ghost-fill text-ghost-text-muted hover:bg-ghost-fill-strong transition-colors"
                  title="Decrease auto-send interval"
                >
                  -
                </button>
                <span className="text-[8px] text-ghost-text-muted w-5 text-center" title="Interval between automatic sends to Ollama (seconds)">
                  {autoSendInterval}s
                </span>
                <button
                  onClick={() => changeInterval(5)}
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
                      {renaming?.label === seg.speaker ? (
                        <input
                          autoFocus
                          aria-label={`Name for speaker ${seg.speaker}`}
                          value={renaming.draft}
                          onChange={e => setRenaming({ label: seg.speaker, draft: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setRenaming(null)
                          }}
                          onBlur={commitRename}
                          placeholder={seg.speaker}
                          className="w-20 mr-1 px-1 rounded text-[8px] bg-ghost-fill-strong text-ghost-text border border-ghost-accent/50 focus:outline-none align-middle"
                        />
                      ) : isRenamable(seg.speaker) ? (
                        <button
                          onClick={() => setRenaming({ label: seg.speaker, draft: speakerNames[seg.speaker] ?? '' })}
                          className={`inline-block px-1 rounded text-[8px] font-medium mr-1 align-middle hover:ring-1 hover:ring-current ${speakerChipClass(seg.speaker)}`}
                          title="Click to rename this speaker"
                        >
                          {displaySpeaker(seg.speaker, speakerNames)}
                        </button>
                      ) : (
                        <span className={`inline-block px-1 rounded text-[8px] font-medium mr-1 align-middle ${speakerChipClass(seg.speaker)}`}>
                          {seg.speaker}
                        </span>
                      )}
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
          {offerNotes && onNotes && hasTranscript && status === 'idle' && (
            <div className="flex items-center gap-1.5 text-[9px] text-ghost-text-muted animate-fade-in">
              <span>Recording stopped. Generate meeting notes?</span>
              <button
                onClick={handleNotes}
                disabled={!isConnected}
                className="px-1.5 py-0.5 rounded font-medium bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 disabled:opacity-30 transition-colors"
              >
                Generate notes
              </button>
              <button
                onClick={() => setOfferNotes(false)}
                className="px-1 rounded hover:bg-ghost-fill-strong transition-colors"
                title="Dismiss"
              >
                ×
              </button>
            </div>
          )}
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
                onClick={handleSummarizePTTranscript}
                disabled={!isConnected}
                className="px-2 py-0.5 rounded text-[9px] font-medium bg-blue-500/15 dark:bg-blue-500/25 text-blue-700 dark:text-blue-300 hover:bg-blue-500/25 dark:hover:bg-blue-500/35 disabled:opacity-30 transition-colors"
              >
                Summary PT
              </button>
              {onNotes && (
                <button
                  onClick={handleNotes}
                  disabled={!isConnected}
                  className="px-2 py-0.5 rounded text-[9px] font-medium bg-amber-500/15 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 dark:hover:bg-amber-500/35 disabled:opacity-30 transition-colors"
                  title="Generate meeting notes (summary, decisions, action items, open questions)"
                >
                  Notes
                </button>
              )}
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
