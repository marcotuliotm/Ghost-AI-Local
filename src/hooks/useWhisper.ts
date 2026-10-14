import { useState, useEffect, useCallback, useRef } from 'react'
import { DEFAULT_TRANSCRIPTION_LANGUAGE, DEFAULT_WHISPER_MODEL } from '../lib/whisper'

type WhisperStatus = 'idle' | 'loading' | 'ready' | 'error'

interface UseWhisperReturn {
  status: WhisperStatus
  progress: number
  progressMessage: string
  error: string | null
  // Model the main process has loaded (null until known)
  loadedModel: string | null
  // Ready, but with a different model than the one requested — call loadModel()
  needsReload: boolean
  loadModel: () => Promise<void>
  transcribe: (audio: Float32Array) => Promise<string>
}

/**
 * useWhisper - Local Whisper transcription via IPC to main process.
 *
 * The main process runs @huggingface/transformers with the selected Whisper
 * model (`model`, a Hugging Face id). Audio is sent as ArrayBuffer over IPC
 * together with `language` ('auto' = detect), text comes back.
 * All inference is 100% local - no audio ever leaves the machine.
 */
export function useWhisper(
  model: string = DEFAULT_WHISPER_MODEL,
  language: string = DEFAULT_TRANSCRIPTION_LANGUAGE,
): UseWhisperReturn {
  const [status, setStatus] = useState<WhisperStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadedModel, setLoadedModel] = useState<string | null>(null)
  const loadingRef = useRef(false)
  // Read at call time so a language change applies to the next segment
  const languageRef = useRef(language)
  languageRef.current = language

  // Listen for progress events from main process
  useEffect(() => {
    const cleanup = window.ghostAPI.onWhisperProgress((data) => {
      if (data.status === 'download') {
        setStatus('loading')
        setProgress(data.progress)
        setProgressMessage(data.message)
      } else if (data.status === 'ready') {
        setStatus('ready')
        setProgress(100)
        setProgressMessage(data.message)
        if (data.model) setLoadedModel(data.model)
      } else if (data.status === 'error') {
        setStatus('error')
        setError(data.message)
        setProgressMessage('')
      }
    })

    // Check current status on mount
    window.ghostAPI.whisperStatus().then((res) => {
      if (res.status === 'ready') {
        setStatus('ready')
        setProgress(100)
        if (res.model) setLoadedModel(res.model)
      } else if (res.status === 'loading') {
        setStatus('loading')
      } else if (res.status === 'error') {
        setStatus('error')
        setError(res.error || 'Unknown error')
      }
    })

    return cleanup
  }, [])

  // An unknown loaded model (older main process) is treated as up to date.
  const needsReload = status === 'ready' && loadedModel !== null && loadedModel !== model

  const loadModel = useCallback(async () => {
    if ((status === 'ready' && !needsReload) || loadingRef.current) return

    loadingRef.current = true
    setStatus('loading')
    setProgress(0)
    setError(null)
    setProgressMessage('Initializing Whisper...')

    try {
      const result = await window.ghostAPI.whisperLoad(model)
      if (result.status === 'ready') {
        setStatus('ready')
        setProgress(100)
        setProgressMessage('Whisper ready')
        setLoadedModel(result.model ?? model)
      } else if (result.status === 'error') {
        setStatus('error')
        setError(result.error || 'Failed to load')
      }
    } catch (err: any) {
      setStatus('error')
      setError(err.message || 'Failed to load Whisper')
    } finally {
      loadingRef.current = false
    }
  }, [status, needsReload, model])

  const transcribe = useCallback(async (audio: Float32Array): Promise<string> => {
    if (status !== 'ready') {
      throw new Error('Whisper not loaded. Call loadModel() first.')
    }

    if (audio.length === 0) return ''

    // Send audio as ArrayBuffer over IPC
    const result = await window.ghostAPI.whisperTranscribe(audio.buffer as ArrayBuffer, languageRef.current)

    if (!result.success) {
      throw new Error(result.error || 'Transcription failed')
    }

    return result.text || ''
  }, [status])

  return { status, progress, progressMessage, error, loadedModel, needsReload, loadModel, transcribe }
}
