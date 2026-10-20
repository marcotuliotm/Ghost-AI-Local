import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Overlay } from '../components/Overlay'
import type { ChatMessage, Settings } from '../types'
import { makeSettings } from './fixtures'

// Stub AudioCapture so tests can drive its callbacks directly
vi.mock('../components/AudioCapture', () => ({
  AudioCapture: (props: any) => (
    <div>
      <button onClick={() => props.onTranscriptChange?.('A: what is the budget?\nYou: about ten thousand')}>set-transcript</button>
      <button onClick={() => props.onTranscription('A: and the deadline?')}>auto-delta</button>
      <button onClick={() => props.onSummarize()}>stub-summarize</button>
      <button onClick={() => props.onSummarizePT()}>stub-summarize-pt</button>
    </div>
  ),
}))

const settings: Settings = makeSettings({
  ollamaBaseUrl: 'http://localhost:11434',
  selectedModel: 'gemma4:latest',
  systemPrompt: 'You are Ghost AI.',
  suggestReplyPrompt: 'They said: {{transcript}}',
  opacity: 0.9,
  fontSize: 12,
  transcriptionInterval: 10,
  speakerThreshold: 0.85,
  contextLength: 8192,
})

const props = {
  messages: [] as ChatMessage[],
  isStreaming: false,
  isConnected: true,
  models: [],
  settings,
  askSuggestion: vi.fn(),
  analyzeScreenshot: vi.fn(),
  analyzeScreenshotCrop: vi.fn(),
  clearChat: vi.fn(),
  updateSettings: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenHelp: vi.fn(),
}

const TRANSCRIPT = 'A: what is the budget?\nYou: about ten thousand'

describe('Overlay transcript context', () => {
  it('should send typed questions as-is, with the transcript as context', () => {
    const sendMessage = vi.fn()
    render(<Overlay {...props} sendMessage={sendMessage} />)
    fireEvent.click(screen.getByText('set-transcript'))

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'What should I say?' } })
    fireEvent.submit(input.closest('form')!)

    expect(sendMessage).toHaveBeenCalledWith('What should I say?', undefined, { context: TRANSCRIPT })
  })

  it('should fill the suggest-reply prompt with only the excerpt and pass the rest as context', () => {
    const sendMessage = vi.fn()
    render(<Overlay {...props} sendMessage={sendMessage} />)
    fireEvent.click(screen.getByText('set-transcript'))
    fireEvent.click(screen.getByText('auto-delta'))

    expect(sendMessage).toHaveBeenCalledWith('They said: A: and the deadline?', undefined, { context: TRANSCRIPT })
  })

  it('should not embed the transcript in Summarize / Summary PT prompts', () => {
    const sendMessage = vi.fn()
    render(<Overlay {...props} sendMessage={sendMessage} />)
    fireEvent.click(screen.getByText('set-transcript'))
    fireEvent.click(screen.getByText('stub-summarize'))
    fireEvent.click(screen.getByText('stub-summarize-pt'))

    for (const [prompt, screenshot, options] of sendMessage.mock.calls) {
      expect(prompt).not.toContain('budget')
      expect(screenshot).toBeUndefined()
      // Transcript only: earlier summaries in the chat would just fill the window
      expect(options).toEqual({ context: TRANSCRIPT, standalone: true })
    }
    expect(sendMessage.mock.calls[1][0]).toContain('pt-BR')
  })

  it('should decline auto-send while a reply is streaming', () => {
    const sendMessage = vi.fn()
    render(<Overlay {...props} isStreaming sendMessage={sendMessage} />)
    fireEvent.click(screen.getByText('auto-delta'))
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
