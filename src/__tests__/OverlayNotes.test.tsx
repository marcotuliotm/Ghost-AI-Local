import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Overlay } from '../components/Overlay'
import type { ChatMessage } from '../types'
import { makeSettings } from './fixtures'
import { NOTES_REQUEST } from '../lib/notes'

// Stub AudioCapture so tests can drive its callbacks directly
vi.mock('../components/AudioCapture', () => ({
  AudioCapture: (props: any) => (
    <div>
      <button onClick={() => props.onTranscriptChange?.('A: can you send the draft by Friday?\nYou: yes, I will')}>set-transcript</button>
      <button onClick={() => props.onNotes?.()}>stub-notes</button>
      <span>{props.canLoadWhisper ? 'whisper-allowed' : 'whisper-waiting'}</span>
    </div>
  ),
}))

const settings = makeSettings({ activePresetId: 'sales-call' })

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

describe('Overlay meeting notes', () => {
  it('should request notes from the transcript context without chat history', () => {
    const sendMessage = vi.fn()
    render(<Overlay {...props} sendMessage={sendMessage} />)
    fireEvent.click(screen.getByText('set-transcript'))
    fireEvent.click(screen.getByText('stub-notes'))

    expect(sendMessage).toHaveBeenCalledTimes(1)
    const [prompt, screenshot, options] = sendMessage.mock.calls[0]
    expect(prompt).toBe(NOTES_REQUEST)
    expect(screenshot).toBeUndefined()
    expect(options.kind).toBe('notes')
    expect(options.standalone).toBe(true)
    expect(options.context).toContain('A: can you send the draft by Friday?')
    expect(options.systemPrompt).toContain('## Action items')
    expect(options.systemPrompt).toContain('- [ ] task — owner')
    expect(options.systemPrompt).toContain('You, A') // owners from diarization labels
    expect(options.systemPrompt).toContain('Write the notes in English') // default transcription language
  })

  it('should write the notes in the transcription language from Settings', () => {
    const sendMessage = vi.fn()
    render(<Overlay {...props} settings={{ ...settings, transcriptionLanguage: 'portuguese' }} sendMessage={sendMessage} />)
    fireEvent.click(screen.getByText('set-transcript'))
    fireEvent.click(screen.getByText('stub-notes'))
    expect(sendMessage.mock.calls[0][2].systemPrompt).toContain('Write the notes in Portuguese, the language of the conversation.')
  })

  it('should follow the transcript language on auto-detect', () => {
    const sendMessage = vi.fn()
    render(<Overlay {...props} settings={{ ...settings, transcriptionLanguage: 'auto' }} sendMessage={sendMessage} />)
    fireEvent.click(screen.getByText('set-transcript'))
    fireEvent.click(screen.getByText('stub-notes'))
    expect(sendMessage.mock.calls[0][2].systemPrompt).toContain('same language as the transcript')
  })

  it('should not request notes without a transcript', () => {
    const sendMessage = vi.fn()
    render(<Overlay {...props} sendMessage={sendMessage} />)
    fireEvent.click(screen.getByText('stub-notes'))
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('should save notes as Markdown with an AI-generated file name', async () => {
    window.ghostAPI.ollamaChat = vi.fn().mockResolvedValue({ success: true, message: { role: 'assistant', content: 'Draft Review' } })
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: NOTES_REQUEST, timestamp: Date.now() },
      { id: '2', role: 'assistant', content: '## Summary\nDraft due Friday.\n\n## Action items\n- [ ] Send draft — You', timestamp: Date.now(), kind: 'notes' },
    ]
    render(<Overlay {...props} messages={messages} sendMessage={vi.fn()} />)

    fireEvent.click(screen.getByText('Save .md'))

    await waitFor(() => expect(window.ghostAPI.saveConversation).toHaveBeenCalled())
    const payload = (window.ghostAPI.saveConversation as any).mock.calls[0][0]
    expect(payload.format).toBe('md')
    expect(payload.suggestedName).toMatch(/^notes_draft_review_\d{4}-\d{2}-\d{2}\.md$/)
    expect(payload.content.startsWith('# Meeting notes')).toBe(true)
    expect(payload.content).toContain('Preset: Sales call')
    expect(payload.content).toContain('- [ ] Send draft — You')
    // The file name prompt reuses the shared helper, without reasoning
    const nameRequest = (window.ghostAPI.ollamaChat as any).mock.calls[0][0]
    expect(nameRequest.messages[0].content).toContain('meeting')
    expect(nameRequest.think).toBe(false)
  })

  it('should fall back to a timestamped name when Ollama is offline', async () => {
    const messages: ChatMessage[] = [
      { id: '2', role: 'assistant', content: '## Summary\nx', timestamp: Date.now(), kind: 'notes' },
    ]
    render(<Overlay {...props} isConnected={false} messages={messages} sendMessage={vi.fn()} />)
    fireEvent.click(screen.getByText('Save .md'))
    await waitFor(() => expect(window.ghostAPI.saveConversation).toHaveBeenCalled())
    const payload = (window.ghostAPI.saveConversation as any).mock.calls[0][0]
    expect(payload.suggestedName).toMatch(/^meeting_notes_\d{4}-\d{2}-\d{2}_\d{2}h\d{2}\.md$/)
    expect(window.ghostAPI.ollamaChat).not.toHaveBeenCalled()
  })

  it('should still save the chat log as .txt', async () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ]
    render(<Overlay {...props} messages={messages} sendMessage={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Save conversation to .txt'))
    await waitFor(() => expect(window.ghostAPI.saveConversation).toHaveBeenCalled())
    const payload = (window.ghostAPI.saveConversation as any).mock.calls[0][0]
    expect(payload.format).toBe('txt')
    expect(payload.suggestedName.endsWith('.txt')).toBe(true)
  })

  it('should hold Whisper loading until settings are loaded', () => {
    const { rerender } = render(<Overlay {...props} sendMessage={vi.fn()} settingsLoaded={false} />)
    expect(screen.getByText('whisper-waiting')).toBeInTheDocument()
    rerender(<Overlay {...props} sendMessage={vi.fn()} settingsLoaded={true} />)
    expect(screen.getByText('whisper-allowed')).toBeInTheDocument()
  })
})
