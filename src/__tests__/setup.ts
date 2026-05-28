import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock crypto.randomUUID
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 9),
  },
})

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = vi.fn()

// Mock window.ghostAPI
const createMockGhostAPI = () => ({
  ollamaChat: vi.fn().mockResolvedValue({ success: true, message: { role: 'assistant', content: 'test response' } }),
  ollamaChatStream: vi.fn().mockResolvedValue({ success: true, message: { role: 'assistant', content: 'test response' } }),
  ollamaListModels: vi.fn().mockResolvedValue({ success: true, models: [{ name: 'gemma3:12b', size: 1000000, digest: 'abc', modified_at: '2024-01-01' }] }),
  ollamaCheck: vi.fn().mockResolvedValue({ connected: true }),
  captureScreenshot: vi.fn().mockResolvedValue(null),
  captureScreenshotCrop: vi.fn().mockResolvedValue(null),
  minimizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  setIgnoreMouse: vi.fn(),
  moveWindow: vi.fn(),
  resizeWindow: vi.fn(),
  setOpacity: vi.fn(),
  requestMicPermission: vi.fn().mockResolvedValue({ granted: true }),
  getMicStatus: vi.fn().mockResolvedValue({ status: 'granted' }),
  whisperLoad: vi.fn().mockResolvedValue({ status: 'ready' }),
  whisperTranscribe: vi.fn().mockResolvedValue({ success: true, text: 'transcribed text' }),
  whisperStatus: vi.fn().mockResolvedValue({ status: 'idle' }),
  saveConversation: vi.fn().mockResolvedValue({ success: true, path: '/test/path.txt' }),
  onWhisperProgress: vi.fn().mockReturnValue(() => {}),
  onStreamChunk: vi.fn().mockReturnValue(() => {}),
  onStreamDone: vi.fn().mockReturnValue(() => {}),
  onScreenshotCaptured: vi.fn().mockReturnValue(() => {}),
  onFocusInput: vi.fn().mockReturnValue(() => {}),
  onOpenSettings: vi.fn().mockReturnValue(() => {}),
  onOverlayVisibility: vi.fn().mockReturnValue(() => {}),
})

Object.defineProperty(window, 'ghostAPI', {
  value: createMockGhostAPI(),
  writable: true,
})

// Re-create mock before each test
beforeEach(() => {
  ;(window as any).ghostAPI = createMockGhostAPI()
})

// Mock MediaStream
class MockMediaStream {
  getTracks() { return [] }
  getAudioTracks() { return [] }
  getVideoTracks() { return [] }
  addTrack() {}
  removeTrack() {}
  clone() { return new MockMediaStream() }
}
;(globalThis as any).MediaStream = MockMediaStream

// Mock MediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
    getDisplayMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
  },
  writable: true,
})

// Mock AudioContext
class MockAudioContext {
  sampleRate = 48000
  createAnalyser() {
    return {
      connect: vi.fn(),
      frequencyBinCount: 1024,
      getByteFrequencyData: vi.fn(),
      fftSize: 2048,
    }
  }
  createScriptProcessor() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    }
  }
  createMediaStreamSource() {
    return { connect: vi.fn() }
  }
  createChannelMerger() {
    return { connect: vi.fn() }
  }
  close() {}
  get destination() {
    return {}
  }
}

;(globalThis as any).AudioContext = MockAudioContext
;(globalThis as any).webkitAudioContext = MockAudioContext
