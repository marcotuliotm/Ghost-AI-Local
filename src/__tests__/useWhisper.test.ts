import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useWhisper } from '../hooks/useWhisper'

describe('useWhisper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should start with idle status', () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })
      const { result } = renderHook(() => useWhisper())
      expect(result.current.status).toBe('idle')
      expect(result.current.progress).toBe(0)
      expect(result.current.error).toBeNull()
    })

    it('should check whisper status on mount', () => {
      renderHook(() => useWhisper())
      expect(window.ghostAPI.whisperStatus).toHaveBeenCalled()
    })

    it('should register progress listener on mount', () => {
      renderHook(() => useWhisper())
      expect(window.ghostAPI.onWhisperProgress).toHaveBeenCalled()
    })

    it('should set ready if whisperStatus returns ready', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      const { result } = renderHook(() => useWhisper())

      await waitFor(() => {
        expect(result.current.status).toBe('ready')
        expect(result.current.progress).toBe(100)
      })
    })

    it('should set loading if whisperStatus returns loading', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'loading' })
      const { result } = renderHook(() => useWhisper())

      await waitFor(() => {
        expect(result.current.status).toBe('loading')
      })
    })

    it('should set error if whisperStatus returns error', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'error', error: 'ONNX failed' })
      const { result } = renderHook(() => useWhisper())

      await waitFor(() => {
        expect(result.current.status).toBe('error')
        expect(result.current.error).toBe('ONNX failed')
      })
    })
  })

  describe('loadModel', () => {
    it('should call whisperLoad and set ready on success', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })
      window.ghostAPI.whisperLoad = vi.fn().mockResolvedValue({ status: 'ready' })
      const { result } = renderHook(() => useWhisper())

      await act(async () => {
        await result.current.loadModel()
      })

      expect(window.ghostAPI.whisperLoad).toHaveBeenCalled()
      expect(result.current.status).toBe('ready')
      expect(result.current.progress).toBe(100)
    })

    it('should not call whisperLoad if already ready', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      const { result } = renderHook(() => useWhisper())

      await waitFor(() => expect(result.current.status).toBe('ready'))

      await act(async () => {
        await result.current.loadModel()
      })

      expect(window.ghostAPI.whisperLoad).not.toHaveBeenCalled()
    })

    it('should set error on load failure', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })
      window.ghostAPI.whisperLoad = vi.fn().mockResolvedValue({ status: 'error', error: 'Download failed' })
      const { result } = renderHook(() => useWhisper())

      await act(async () => {
        await result.current.loadModel()
      })

      expect(result.current.status).toBe('error')
      expect(result.current.error).toBe('Download failed')
    })

    it('should handle exception during load', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })
      window.ghostAPI.whisperLoad = vi.fn().mockRejectedValue(new Error('Network error'))
      const { result } = renderHook(() => useWhisper())

      await act(async () => {
        await result.current.loadModel()
      })

      expect(result.current.status).toBe('error')
      expect(result.current.error).toBe('Network error')
    })
  })

  describe('transcribe', () => {
    it('should return transcribed text on success', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      window.ghostAPI.whisperTranscribe = vi.fn().mockResolvedValue({ success: true, text: 'hello world' })
      const { result } = renderHook(() => useWhisper())

      await waitFor(() => expect(result.current.status).toBe('ready'))

      let text = ''
      await act(async () => {
        text = await result.current.transcribe(new Float32Array([0.1, 0.2, 0.3]))
      })

      expect(text).toBe('hello world')
      expect(window.ghostAPI.whisperTranscribe).toHaveBeenCalled()
    })

    it('should throw if not ready', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })
      const { result } = renderHook(() => useWhisper())

      await expect(
        act(async () => {
          await result.current.transcribe(new Float32Array([0.1]))
        })
      ).rejects.toThrow('Whisper not loaded')
    })

    it('should return empty string for empty audio', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      const { result } = renderHook(() => useWhisper())

      await waitFor(() => expect(result.current.status).toBe('ready'))

      let text = ''
      await act(async () => {
        text = await result.current.transcribe(new Float32Array([]))
      })

      expect(text).toBe('')
    })

    it('should throw on transcription error', async () => {
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'ready' })
      window.ghostAPI.whisperTranscribe = vi.fn().mockResolvedValue({ success: false, error: 'ONNX runtime error' })
      const { result } = renderHook(() => useWhisper())

      await waitFor(() => expect(result.current.status).toBe('ready'))

      await expect(
        act(async () => {
          await result.current.transcribe(new Float32Array([0.1, 0.2]))
        })
      ).rejects.toThrow('ONNX runtime error')
    })
  })

  describe('progress callback', () => {
    it('should update progress on download events', async () => {
      let progressCallback: any = null
      window.ghostAPI.onWhisperProgress = vi.fn().mockImplementation((cb) => {
        progressCallback = cb
        return () => {}
      })
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })

      const { result } = renderHook(() => useWhisper())

      act(() => {
        progressCallback({ status: 'download', message: 'Downloading... 50%', progress: 50 })
      })

      expect(result.current.status).toBe('loading')
      expect(result.current.progress).toBe(50)
      expect(result.current.progressMessage).toBe('Downloading... 50%')
    })

    it('should set ready on ready event', async () => {
      let progressCallback: any = null
      window.ghostAPI.onWhisperProgress = vi.fn().mockImplementation((cb) => {
        progressCallback = cb
        return () => {}
      })
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })

      const { result } = renderHook(() => useWhisper())

      act(() => {
        progressCallback({ status: 'ready', message: 'Whisper ready', progress: 100 })
      })

      expect(result.current.status).toBe('ready')
      expect(result.current.progress).toBe(100)
    })

    it('should set error on error event', async () => {
      let progressCallback: any = null
      window.ghostAPI.onWhisperProgress = vi.fn().mockImplementation((cb) => {
        progressCallback = cb
        return () => {}
      })
      window.ghostAPI.whisperStatus = vi.fn().mockResolvedValue({ status: 'idle' })

      const { result } = renderHook(() => useWhisper())

      act(() => {
        progressCallback({ status: 'error', message: 'Model load failed', progress: 0 })
      })

      expect(result.current.status).toBe('error')
      expect(result.current.error).toBe('Model load failed')
    })
  })
})
