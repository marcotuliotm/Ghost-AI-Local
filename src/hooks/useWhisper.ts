import { useState, useEffect, useCallback, useRef } from 'react'

type WhisperStatus = 'idle' | 'loading' | 'ready' | 'error'

interface UseWhisperReturn {
  status: WhisperStatus
  progress: number
  progressMessage: string
  error: string | null
  loadModel: () => Promise<void>
  transcribe: (audio: Float32Array) => Promise<string>
}

/**
 * useWhisper - Local Whisper transcription via IPC to main process.
 *
 * The main process runs @xenova/transformers with Whisper-tiny.
 * Audio is sent as ArrayBuffer over IPC, text comes back.
 * All inference is 100% local - no audio ever leaves the machine.
 */
export function useWhisper(): UseWhisperReturn {
  const [status, setStatus] = useState<WhisperStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)

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
      } else if (res.status === 'loading') {
        setStatus('loading')
      } else if (res.status === 'error') {
        setStatus('error')
        setError(res.error || 'Unknown error')
      }
    })

    return cleanup
  }, [])

  const loadModel = useCallback(async () => {
    if (status === 'ready' || loadingRef.current) return

    loadingRef.current = true
    setStatus('loading')
    setProgress(0)
    setError(null)
    setProgressMessage('Initializing Whisper...')

    try {
      const result = await window.ghostAPI.whisperLoad()
      if (result.status === 'ready') {
        setStatus('ready')
        setProgress(100)
        setProgressMessage('Whisper ready')
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
  }, [status])

  const transcribe = useCallback(async (audio: Float32Array): Promise<string> => {
    if (status !== 'ready') {
      throw new Error('Whisper not loaded. Call loadModel() first.')
    }

    if (audio.length === 0) return ''

    // Send audio as ArrayBuffer over IPC
    const result = await window.ghostAPI.whisperTranscribe(audio.buffer as ArrayBuffer)

    if (!result.success) {
      throw new Error(result.error || 'Transcription failed')
    }

    return result.text || ''
  }, [status])

  return { status, progress, progressMessage, error, loadModel, transcribe }
}
