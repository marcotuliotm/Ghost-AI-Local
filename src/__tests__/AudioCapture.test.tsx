import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AudioCapture } from '../components/AudioCapture'

const defaultProps = {
  onTranscription: vi.fn(),
  onSummarize: vi.fn(),
  onSummarizePT: vi.fn(),
  isConnected: true,
  settings: {
    selectedModel: 'gemma4:latest',
    ollamaBaseUrl: 'http://localhost:11434',
    transcriptionInterval: 10,
    contextLength: 8192,
    speakerThreshold: 0.85,
  },
}

describe('AudioCapture', () => {
  describe('rendering with whisper ready', () => {
    beforeEach(() => {
      // Make whisper ready so audio source buttons appear
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      window.ghostAPI.whisperLoad = vi.fn().mockResolvedValue({ status: 'ready' })
    })

    it('should render audio source toggle buttons when whisper is ready', async () => {
      render(<AudioCapture {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Mic')).toBeInTheDocument()
        expect(screen.getByText('System')).toBeInTheDocument()
        expect(screen.getByText('Both')).toBeInTheDocument()
      })
    })

    it('should default to system audio source', async () => {
      render(<AudioCapture {...defaultProps} />)
      await waitFor(() => {
        const systemButton = screen.getByText('System')
        expect(systemButton.className).toContain('bg-ghost-surface')
      })
    })

    it('should toggle to mic when Mic is clicked', async () => {
      render(<AudioCapture {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Mic')).toBeInTheDocument()
      })
      const micButton = screen.getByText('Mic')
      fireEvent.click(micButton)
      expect(micButton.className).toContain('bg-ghost-surface')
    })

    it('should toggle to both when Both is clicked', async () => {
      render(<AudioCapture {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Both')).toBeInTheDocument()
      })
      const bothButton = screen.getByText('Both')
      fireEvent.click(bothButton)
      expect(bothButton.className).toContain('bg-ghost-surface')
    })

    it('should show record button when whisper ready', async () => {
      render(<AudioCapture {...defaultProps} />)
      await waitFor(() => {
        // When whisper is ready + status idle + source 'system', title is "Transcribe: Audio from meetings/videos"
        const recordButton = screen.getByTitle(/Transcribe/)
        expect(recordButton).toBeInTheDocument()
      })
    })

    it('should render the Speakers (diarization) toggle', async () => {
      render(<AudioCapture {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Speakers')).toBeInTheDocument()
      })
    })

    it('should load the speaker-embedding model when Speakers is enabled', async () => {
      render(<AudioCapture {...defaultProps} />)
      const toggle = await screen.findByText('Speakers')
      fireEvent.click(toggle)
      await waitFor(() => {
        expect(window.ghostAPI.embedLoad).toHaveBeenCalled()
      })
    })
  })

  describe('capture pipeline', () => {
    const makeReady = () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      window.ghostAPI.whisperLoad = vi.fn().mockResolvedValue({ status: 'ready' })
    }

    // 16 kHz context so the test needs no OfflineAudioContext resampling
    const tone = (n: number) => Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin(i / 5))

    it('should transcribe a phrase once a pause closes it (ScriptProcessor fallback)', async () => {
      makeReady()
      const processors: any[] = []
      const Base = (globalThis as any).AudioContext
      class Ctx16k extends Base {
        sampleRate = 16000
        createScriptProcessor() {
          const p = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as any }
          processors.push(p)
          return p
        }
      }
      ;(globalThis as any).AudioContext = Ctx16k
      try {
        render(<AudioCapture {...defaultProps} />)
        fireEvent.click(await screen.findByText('Mic'))
        fireEvent.click(await screen.findByTitle(/Transcribe/))
        await waitFor(() => expect(processors).toHaveLength(1))

        const send = (data: Float32Array) =>
          processors[0].onaudioprocess({ inputBuffer: { getChannelData: () => data } })
        // 1 s of speech: still open, nothing transcribed yet
        for (let i = 0; i < 4; i++) send(tone(4096))
        expect(window.ghostAPI.whisperTranscribe).not.toHaveBeenCalled()
        // ~1 s of silence closes the segment
        for (let i = 0; i < 4; i++) send(new Float32Array(4096))

        await waitFor(() => expect(window.ghostAPI.whisperTranscribe).toHaveBeenCalledTimes(1))
        expect(await screen.findByText('transcribed text')).toBeInTheDocument()
      } finally {
        ;(globalThis as any).AudioContext = Base
      }
    })

    it('should use an AudioWorklet when the context supports it', async () => {
      makeReady()
      const addModule = vi.fn().mockResolvedValue(undefined)
      const workletNodes: any[] = []
      const Base = (globalThis as any).AudioContext
      class WorkletCtx extends Base {
        audioWorklet = { addModule }
      }
      ;(globalThis as any).AudioContext = WorkletCtx
      ;(globalThis as any).AudioWorkletNode = class {
        port = { onmessage: null as any }
        connect = vi.fn()
        disconnect = vi.fn()
        constructor(_ctx: unknown, public name: string) { workletNodes.push(this) }
      }
      const createObjectURL = vi.fn().mockReturnValue('blob:worklet')
      const revokeObjectURL = vi.fn()
      Object.assign(URL, { createObjectURL, revokeObjectURL })
      try {
        render(<AudioCapture {...defaultProps} />)
        fireEvent.click(await screen.findByText('Mic'))
        fireEvent.click(await screen.findByTitle(/Transcribe/))

        await waitFor(() => expect(workletNodes).toHaveLength(1))
        expect(addModule).toHaveBeenCalledWith('blob:worklet')
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:worklet')
        expect(workletNodes[0].name).toBe('ghost-capture')
        expect(typeof workletNodes[0].port.onmessage).toBe('function')
      } finally {
        ;(globalThis as any).AudioContext = Base
        delete (globalThis as any).AudioWorkletNode
      }
    })
  })

  describe('microphone permission', () => {
    it('should show a permission error instead of capturing when mic access is denied', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      window.ghostAPI.whisperLoad = vi.fn().mockResolvedValue({ status: 'ready' })
      window.ghostAPI.requestMicPermission = vi.fn().mockResolvedValue({ granted: false })
      const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia)
      getUserMedia.mockClear()

      render(<AudioCapture {...defaultProps} />)
      fireEvent.click(await screen.findByText('Mic'))
      fireEvent.click(await screen.findByTitle(/Transcribe/))

      expect(await screen.findByText(/Microphone permission denied/)).toBeInTheDocument()
      expect(getUserMedia).not.toHaveBeenCalled()
    })
  })

  describe('rendering with whisper loading', () => {
    it('should show loading state when whisper is loading', () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'loading' })
      render(<AudioCapture {...defaultProps} />)
      expect(screen.getByText('Initializing Whisper...')).toBeInTheDocument()
    })

    it('should show disabled record button when loading', () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'loading' })
      render(<AudioCapture {...defaultProps} />)
      const button = screen.getByTitle('Waiting for Whisper...')
      expect(button).toBeDisabled()
    })
  })

  describe('whisper error', () => {
    it('should show error message and retry button', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'error', error: 'Download failed' })
      window.ghostAPI.whisperLoad = vi.fn().mockResolvedValue({ status: 'error', error: 'Download failed' })
      render(<AudioCapture {...defaultProps} />)

      await waitFor(() => {
        // Error text is rendered as "Whisper: Download failed"
        expect(screen.getByText(/Download failed/)).toBeInTheDocument()
        expect(screen.getByText('Retry')).toBeInTheDocument()
      })
    })
  })

  describe('whisper model loading', () => {
    it('should trigger model load when whisper is idle', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })
      render(<AudioCapture {...defaultProps} />)

      await waitFor(() => {
        expect(window.ghostAPI.whisperLoad).toHaveBeenCalled()
      })
    })
  })

  describe('props', () => {
    it('should accept all callbacks without error', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      window.ghostAPI.whisperLoad = vi.fn().mockResolvedValue({ status: 'ready' })
      const onTranscription = vi.fn()
      const onSummarize = vi.fn()
      const onSummarizePT = vi.fn()
      render(
        <AudioCapture
          {...defaultProps}
          onTranscription={onTranscription}
          onSummarize={onSummarize}
          onSummarizePT={onSummarizePT}
        />
      )
      await waitFor(() => {
        expect(screen.getByText('Mic')).toBeInTheDocument()
      })
    })

    it('should use settings.transcriptionInterval', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      window.ghostAPI.whisperLoad = vi.fn().mockResolvedValue({ status: 'ready' })
      render(
        <AudioCapture
          {...defaultProps}
          settings={{ ...defaultProps.settings, transcriptionInterval: 5 }}
        />
      )
      await waitFor(() => {
        expect(screen.getByText('Mic')).toBeInTheDocument()
      })
    })
  })

  describe('whisper model and notes', () => {
    const tone = (n: number) => Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin(i / 5))

    // Start a mic recording on a 16 kHz ScriptProcessor graph and return a
    // function that feeds it audio.
    async function startRecording(processors: any[]) {
      fireEvent.click(await screen.findByText('Mic'))
      fireEvent.click(await screen.findByTitle(/Transcribe/))
      await waitFor(() => expect(processors).toHaveLength(1))
      return (data: Float32Array) => processors[0].onaudioprocess({ inputBuffer: { getChannelData: () => data } })
    }

    function use16kContext() {
      const processors: any[] = []
      const Base = (globalThis as any).AudioContext
      class Ctx16k extends Base {
        sampleRate = 16000
        createScriptProcessor() {
          const p = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as any }
          processors.push(p)
          return p
        }
      }
      ;(globalThis as any).AudioContext = Ctx16k
      return { processors, restore: () => { (globalThis as any).AudioContext = Base } }
    }

    it('should load the Whisper model chosen in Settings', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })
      render(<AudioCapture {...defaultProps} settings={{ ...defaultProps.settings, whisperModel: 'onnx-community/whisper-small' }} />)
      await waitFor(() => expect(window.ghostAPI.whisperLoad).toHaveBeenCalledWith('onnx-community/whisper-small'))
    })

    it('should not load Whisper until allowed', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })
      const { rerender } = render(<AudioCapture {...defaultProps} canLoadWhisper={false} />)
      await new Promise(r => setTimeout(r, 20))
      expect(window.ghostAPI.whisperLoad).not.toHaveBeenCalled()
      rerender(<AudioCapture {...defaultProps} canLoadWhisper={true} />)
      await waitFor(() => expect(window.ghostAPI.whisperLoad).toHaveBeenCalled())
    })

    it('should pass the transcription language to Whisper', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready', model: 'onnx-community/whisper-base' })
      const { processors, restore } = use16kContext()
      try {
        render(<AudioCapture {...defaultProps} settings={{ ...defaultProps.settings, whisperModel: 'onnx-community/whisper-base', transcriptionLanguage: 'portuguese' }} />)
        const send = await startRecording(processors)
        for (let i = 0; i < 4; i++) send(tone(4096))
        for (let i = 0; i < 4; i++) send(new Float32Array(4096))
        await waitFor(() => expect(window.ghostAPI.whisperTranscribe).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'portuguese'))
      } finally {
        restore()
      }
    })

    it('should defer a model switch until recording stops', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready', model: 'onnx-community/whisper-tiny' })
      window.ghostAPI.whisperLoad = vi.fn().mockImplementation(async (model: string) => ({ status: 'ready', model }))
      const { processors, restore } = use16kContext()
      const tiny = { ...defaultProps.settings, whisperModel: 'onnx-community/whisper-tiny' }
      try {
        const { rerender } = render(<AudioCapture {...defaultProps} settings={tiny} />)
        await startRecording(processors)

        rerender(<AudioCapture {...defaultProps} settings={{ ...tiny, whisperModel: 'onnx-community/whisper-base' }} />)
        expect(await screen.findByText(/new Whisper model will load when you stop recording/)).toBeInTheDocument()
        expect(window.ghostAPI.whisperLoad).not.toHaveBeenCalledWith('onnx-community/whisper-base')

        fireEvent.click(screen.getByTitle('Stop'))
        await waitFor(() => expect(window.ghostAPI.whisperLoad).toHaveBeenCalledWith('onnx-community/whisper-base'))
      } finally {
        restore()
      }
    })

    it('should offer meeting notes after Stop and via the Notes button', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      const onNotes = vi.fn()
      const { processors, restore } = use16kContext()
      try {
        render(<AudioCapture {...defaultProps} onNotes={onNotes} />)
        const send = await startRecording(processors)
        for (let i = 0; i < 4; i++) send(tone(4096))
        for (let i = 0; i < 4; i++) send(new Float32Array(4096))
        expect(await screen.findByText('transcribed text')).toBeInTheDocument()

        // Notes sits in the action row next to Summarize / Summary PT
        fireEvent.click(screen.getByText('Notes'))
        expect(onNotes).toHaveBeenCalledTimes(1)
        expect(screen.queryByText(/Generate meeting notes\?/)).toBeNull()

        fireEvent.click(screen.getByTitle('Stop'))
        expect(await screen.findByText(/Recording stopped. Generate meeting notes\?/)).toBeInTheDocument()
        fireEvent.click(screen.getByText('Generate notes'))
        expect(onNotes).toHaveBeenCalledTimes(2)
        expect(screen.queryByText(/Generate meeting notes\?/)).toBeNull()
      } finally {
        restore()
      }
    })

    it('should let the notes offer be dismissed', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      const { processors, restore } = use16kContext()
      try {
        render(<AudioCapture {...defaultProps} onNotes={vi.fn()} />)
        const send = await startRecording(processors)
        for (let i = 0; i < 4; i++) send(tone(4096))
        for (let i = 0; i < 4; i++) send(new Float32Array(4096))
        await screen.findByText('transcribed text')
        fireEvent.click(screen.getByTitle('Stop'))
        await screen.findByText(/Generate meeting notes\?/)
        fireEvent.click(screen.getByTitle('Dismiss'))
        expect(screen.queryByText(/Generate meeting notes\?/)).toBeNull()
      } finally {
        restore()
      }
    })

    it('should not offer notes after stopping with no transcript', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      const { processors, restore } = use16kContext()
      try {
        render(<AudioCapture {...defaultProps} onNotes={vi.fn()} />)
        await startRecording(processors)
        fireEvent.click(screen.getByTitle('Stop'))
        await screen.findByTitle(/Transcribe/)
        expect(screen.queryByText(/Generate meeting notes\?/)).toBeNull()
      } finally {
        restore()
      }
    })
  })
})
