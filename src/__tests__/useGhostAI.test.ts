import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useGhostAI } from '../hooks/useGhostAI'

describe('useGhostAI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should return default settings', async () => {
      const { result } = renderHook(() => useGhostAI())
      expect(result.current.settings.ollamaBaseUrl).toBe('http://localhost:11434')
      expect(result.current.settings.selectedModel).toBe('gemma4:latest')
      expect(result.current.settings.opacity).toBe(0.9)
      expect(result.current.settings.transcriptionInterval).toBe(10)
      expect(result.current.settings.suggestReplyPrompt).toContain('{{transcript}}')
    })

    it('should start with empty messages', () => {
      const { result } = renderHook(() => useGhostAI())
      expect(result.current.messages).toEqual([])
    })

    it('should start not streaming', () => {
      const { result } = renderHook(() => useGhostAI())
      expect(result.current.isStreaming).toBe(false)
    })

    it('should check connection on mount', async () => {
      renderHook(() => useGhostAI())
      await waitFor(() => {
        expect(window.ghostAPI.ollamaCheck).toHaveBeenCalledWith('http://localhost:11434')
      })
    })

    it('should set up stream listeners on mount', () => {
      renderHook(() => useGhostAI())
      expect(window.ghostAPI.onStreamChunk).toHaveBeenCalled()
      expect(window.ghostAPI.onStreamDone).toHaveBeenCalled()
    })
  })

  describe('checkConnection', () => {
    it('should set isConnected to true when Ollama responds', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => {
        expect(result.current.isConnected).toBe(true)
      })
    })

    it('should set isConnected to false when Ollama is down', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: false })
      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => {
        expect(result.current.isConnected).toBe(false)
      })
    })
  })

  describe('fetchModels', () => {
    it('should populate models list', async () => {
      const mockModels = [
        { name: 'gemma4:latest', size: 8000000000, digest: 'abc', modified_at: '2024-01-01' },
        { name: 'llama3:8b', size: 4000000000, digest: 'def', modified_at: '2024-01-02' },
      ]
      window.ghostAPI.ollamaListModels = vi.fn().mockResolvedValue({ success: true, models: mockModels })
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })

      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => {
        expect(result.current.models.length).toBe(2)
        expect(result.current.models[0].name).toBe('gemma4:latest')
      })
    })

    it('should auto-select first model if current is not available', async () => {
      const mockModels = [
        { name: 'llama3:8b', size: 4000000000, digest: 'def', modified_at: '2024-01-02' },
      ]
      window.ghostAPI.ollamaListModels = vi.fn().mockResolvedValue({ success: true, models: mockModels })
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })

      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => {
        expect(result.current.settings.selectedModel).toBe('llama3:8b')
      })
    })
  })

  describe('sendMessage', () => {
    it('should add user and assistant messages', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      const { result } = renderHook(() => useGhostAI())

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(result.current.messages.length).toBe(2)
      expect(result.current.messages[0].role).toBe('user')
      expect(result.current.messages[0].content).toBe('Hello')
      expect(result.current.messages[1].role).toBe('assistant')
    })

    it('should call ollamaChatStream with correct payload', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      const { result } = renderHook(() => useGhostAI())

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(window.ghostAPI.ollamaChatStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemma4:latest',
          baseUrl: 'http://localhost:11434',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user', content: 'Hello' }),
          ]),
        })
      )
    })

    it('should add screenshot annotation to content', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      const { result } = renderHook(() => useGhostAI())

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.sendMessage('Analyze this', 'data:image/png;base64,abc')
      })

      expect(result.current.messages[0].content).toContain('[Screenshot anexado]')
      expect(result.current.messages[0].content).toContain('Analyze this')
      expect(result.current.messages[0].screenshot).toBe('data:image/png;base64,abc')
    })

    it('should include images array in Ollama payload when screenshot is attached', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      const { result } = renderHook(() => useGhostAI())

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.sendMessage('Analyze this', 'data:image/png;base64,abc123')
      })

      const mock = window.ghostAPI.ollamaChatStream as ReturnType<typeof vi.fn>
      const payload = mock.mock.calls.at(-1)?.[0]
      const userMessage = payload.messages.find((m: any) => m.role === 'user')

      expect(userMessage).toBeDefined()
      expect(userMessage.images).toBeDefined()
      expect(userMessage.images).toEqual(['abc123'])
    })

    it('should strip data:image prefix from base64 before sending to Ollama', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      const { result } = renderHook(() => useGhostAI())

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.sendMessage('Describe', 'data:image/jpeg;base64,/9j/4AAQ')
      })

      const mock = window.ghostAPI.ollamaChatStream as ReturnType<typeof vi.fn>
      const payload = mock.mock.calls.at(-1)?.[0]
      const userMessage = payload.messages.find((m: any) => m.role === 'user')

      expect(userMessage.images[0]).toBe('/9j/4AAQ')
      expect(userMessage.images[0]).not.toContain('data:image')
    })

    it('should not include images field when no screenshot is attached', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      const { result } = renderHook(() => useGhostAI())

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.sendMessage('Hello without image')
      })

      const mock = window.ghostAPI.ollamaChatStream as ReturnType<typeof vi.fn>
      const payload = mock.mock.calls.at(-1)?.[0]
      const userMessage = payload.messages.find((m: any) => m.role === 'user')

      expect(userMessage).toBeDefined()
      expect(userMessage.images).toBeUndefined()
    })

    it('should skip empty messages', async () => {
      const { result } = renderHook(() => useGhostAI())

      await act(async () => {
        await result.current.sendMessage('')
      })

      expect(result.current.messages.length).toBe(0)
      expect(window.ghostAPI.ollamaChatStream).not.toHaveBeenCalled()
    })

    it('should skip when already streaming', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      window.ghostAPI.ollamaChatStream = vi.fn().mockImplementation(() => new Promise(() => {})) // never resolves
      const { result } = renderHook(() => useGhostAI())

      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        result.current.sendMessage('First')
      })

      const messageCount = result.current.messages.length

      await act(async () => {
        await result.current.sendMessage('Second')
      })

      expect(result.current.messages.length).toBe(messageCount)
    })

    it('should handle error response', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      window.ghostAPI.ollamaChatStream = vi.fn().mockResolvedValue({
        success: false,
        error: 'Connection refused',
      })

      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      const assistantMsg = result.current.messages[1]
      expect(assistantMsg.content).toContain('Erro')
      expect(assistantMsg.content).toContain('Connection refused')
      expect(assistantMsg.isStreaming).toBe(false)
      expect(result.current.isStreaming).toBe(false)
    })

    it('should include conversation context (last 20 messages)', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      // Use error response so sendMessage's error branch resets isStreaming
      // This allows the second sendMessage call to proceed
      window.ghostAPI.ollamaChatStream = vi.fn().mockResolvedValue({
        success: false,
        error: 'test error',
      })

      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => expect(result.current.isConnected).toBe(true))

      // Send first message — error path resets isStreaming
      await act(async () => {
        await result.current.sendMessage('First question')
      })

      await waitFor(() => expect(result.current.isStreaming).toBe(false))

      // Send second message - should include first in context
      await act(async () => {
        await result.current.sendMessage('Second question')
      })

      // Verify ollamaChatStream was called twice
      expect(window.ghostAPI.ollamaChatStream).toHaveBeenCalledTimes(2)

      const lastCall = (window.ghostAPI.ollamaChatStream as any).mock.calls.at(-1)[0]
      const messages = lastCall.messages
      expect(messages[0].role).toBe('system')
      // Should have system + first user + first assistant(error) + second user = 4
      expect(messages.length).toBeGreaterThan(2)
    })
  })

  describe('clearChat', () => {
    it('should clear all messages', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(result.current.messages.length).toBeGreaterThan(0)

      act(() => {
        result.current.clearChat()
      })

      expect(result.current.messages).toEqual([])
    })
  })

  describe('updateSettings', () => {
    it('should merge partial settings', () => {
      const { result } = renderHook(() => useGhostAI())

      act(() => {
        result.current.updateSettings({ selectedModel: 'llama3:8b' })
      })

      expect(result.current.settings.selectedModel).toBe('llama3:8b')
      expect(result.current.settings.ollamaBaseUrl).toBe('http://localhost:11434') // unchanged
    })

    it('should update multiple fields at once', () => {
      const { result } = renderHook(() => useGhostAI())

      act(() => {
        result.current.updateSettings({
          selectedModel: 'llama3:8b',
          opacity: 0.5,
          transcriptionInterval: 20,
        })
      })

      expect(result.current.settings.selectedModel).toBe('llama3:8b')
      expect(result.current.settings.opacity).toBe(0.5)
      expect(result.current.settings.transcriptionInterval).toBe(20)
    })

    it('should update suggestReplyPrompt', () => {
      const { result } = renderHook(() => useGhostAI())

      act(() => {
        result.current.updateSettings({
          suggestReplyPrompt: 'Custom prompt: {{transcript}}',
        })
      })

      expect(result.current.settings.suggestReplyPrompt).toBe('Custom prompt: {{transcript}}')
    })
  })

  describe('analyzeScreenshot', () => {
    it('should capture screenshot and send message', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      window.ghostAPI.captureScreenshot = vi.fn().mockResolvedValue('data:image/png;base64,screenshot')
      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.analyzeScreenshot()
      })

      expect(window.ghostAPI.captureScreenshot).toHaveBeenCalled()
      expect(result.current.messages.length).toBe(2)
      expect(result.current.messages[0].screenshot).toBe('data:image/png;base64,screenshot')
    })

    it('should not send if screenshot is null', async () => {
      window.ghostAPI.captureScreenshot = vi.fn().mockResolvedValue(null)
      const { result } = renderHook(() => useGhostAI())

      await act(async () => {
        await result.current.analyzeScreenshot()
      })

      expect(result.current.messages.length).toBe(0)
    })
  })

  describe('analyzeScreenshotCrop', () => {
    it('should capture cropped screenshot and send message', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      window.ghostAPI.captureScreenshotCrop = vi.fn().mockResolvedValue('data:image/png;base64,cropped')
      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.analyzeScreenshotCrop()
      })

      expect(window.ghostAPI.captureScreenshotCrop).toHaveBeenCalled()
      expect(result.current.messages.length).toBe(2)
      expect(result.current.messages[0].screenshot).toBe('data:image/png;base64,cropped')
    })

    it('should not send if crop is cancelled (null)', async () => {
      window.ghostAPI.captureScreenshotCrop = vi.fn().mockResolvedValue(null)
      const { result } = renderHook(() => useGhostAI())

      await act(async () => {
        await result.current.analyzeScreenshotCrop()
      })

      expect(result.current.messages.length).toBe(0)
    })

    it('should include cropped image in Ollama payload', async () => {
      window.ghostAPI.ollamaCheck = vi.fn().mockResolvedValue({ connected: true })
      window.ghostAPI.captureScreenshotCrop = vi.fn().mockResolvedValue('data:image/png;base64,croppedBase64Data')
      const { result } = renderHook(() => useGhostAI())
      await waitFor(() => expect(result.current.isConnected).toBe(true))

      await act(async () => {
        await result.current.analyzeScreenshotCrop()
      })

      const mock = window.ghostAPI.ollamaChatStream as ReturnType<typeof vi.fn>
      const payload = mock.mock.calls.at(-1)?.[0]
      const userMessage = payload.messages.find((m: any) => m.role === 'user')

      expect(userMessage.images).toEqual(['croppedBase64Data'])
    })
  })
})
