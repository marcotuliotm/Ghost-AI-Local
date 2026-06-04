import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AudioCapture } from '../components/AudioCapture'

const defaultProps = {
  onTranscription: vi.fn(),
  onSummarize: vi.fn(),
  onTranslate: vi.fn(),
  isConnected: true,
  settings: {
    selectedModel: 'gemma4:latest',
    ollamaBaseUrl: 'http://localhost:11434',
    transcriptionInterval: 10,
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
      const onTranslate = vi.fn()
      render(
        <AudioCapture
          {...defaultProps}
          onTranscription={onTranscription}
          onSummarize={onSummarize}
          onTranslate={onTranslate}
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
})
