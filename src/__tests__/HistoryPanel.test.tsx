import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { HistoryPanel } from '../components/HistoryPanel'
import { makeSettings } from './fixtures'
import type { Session, SessionSummary } from '../lib/sessions'

const ID = '0b6a8f4e-3c2d-4e1f-9a8b-7c6d5e4f3a2b'
const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: ID, startedAt: Date.UTC(2026, 9, 20, 15), updatedAt: 0, title: 'Budget call', model: 'qwen3.5:latest', preset: 'General',
  messageCount: 2, hasTranscript: true, hasNotes: true, ...over,
})
const session: Session = {
  id: ID, startedAt: Date.UTC(2026, 9, 20, 15), updatedAt: 0, title: 'Budget call', model: 'qwen3.5:latest', preset: 'General',
  transcript: 'Maria: the deadline is Friday',
  messages: [
    { role: 'user', content: 'What should I say?', timestamp: 1 },
    { role: 'assistant', content: '## Summary\nDeadline Friday.', timestamp: 2, kind: 'notes' },
  ],
}

const setup = (settings = makeSettings({ saveSessions: true })) => {
  const updateSettings = vi.fn()
  render(<HistoryPanel settings={settings} updateSettings={updateSettings} onBack={vi.fn()} />)
  return { updateSettings }
}

describe('HistoryPanel', () => {
  it('should explain that saving is off by default and turn it on', async () => {
    const { updateSettings } = setup(makeSettings())
    expect(screen.getByText(/Saving is off/)).toBeInTheDocument()
    expect(await screen.findByText('No saved sessions.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Save sessions'))
    expect(updateSettings).toHaveBeenCalledWith({ saveSessions: true })
  })

  it('should list sessions and search them', async () => {
    window.ghostAPI.sessionsSearch = vi.fn()
      .mockResolvedValueOnce({ sessions: [summary()] })
      .mockResolvedValue({ sessions: [summary({ snippet: '…the deadline is Friday' })] })
    setup()
    expect(await screen.findByText('Budget call')).toBeInTheDocument()
    expect(screen.getByText(/2 messages · transcript · notes/)).toBeInTheDocument()
    expect(screen.queryByText(/Saving is off/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'deadline' } })
    expect(await screen.findByText('…the deadline is Friday')).toBeInTheDocument()
    expect(window.ghostAPI.sessionsSearch).toHaveBeenLastCalledWith('deadline')
  })

  it('should open a session with its transcript, chat and notes, export and delete it', async () => {
    window.ghostAPI.sessionsSearch = vi.fn().mockResolvedValueOnce({ sessions: [summary()] }).mockResolvedValue({ sessions: [] })
    window.ghostAPI.sessionsGet = vi.fn().mockResolvedValue({ session })
    window.ghostAPI.saveConversation = vi.fn().mockResolvedValue({ success: true })
    setup()
    fireEvent.click(await screen.findByText('Budget call'))
    expect(await screen.findByText('What should I say?')).toBeInTheDocument()
    expect(screen.getByText('Maria: the deadline is Friday')).toBeInTheDocument()
    expect(screen.getByText('Save .md')).toBeInTheDocument() // the notes reply

    fireEvent.click(screen.getByText('Export .md'))
    await waitFor(() => expect(window.ghostAPI.saveConversation).toHaveBeenCalled())
    const payload = vi.mocked(window.ghostAPI.saveConversation).mock.calls[0][0]
    expect(payload.format).toBe('md')
    expect(payload.content).toContain('## Transcript')

    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(window.ghostAPI.sessionsDelete).toHaveBeenCalledWith(ID))
    expect(await screen.findByText('No saved sessions.')).toBeInTheDocument()
  })

  it('should ask for a second click before deleting everything', async () => {
    window.ghostAPI.sessionsSearch = vi.fn().mockResolvedValue({ sessions: [summary()] })
    setup()
    fireEvent.click(await screen.findByText('Delete all sessions'))
    expect(window.ghostAPI.sessionsDeleteAll).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Click again to delete all'))
    await waitFor(() => expect(window.ghostAPI.sessionsDeleteAll).toHaveBeenCalled())
  })
})

describe('HistoryPanel encryption', () => {
  it('should warn when sessions cannot be encrypted (and so are not saved)', async () => {
    window.ghostAPI.sessionsStatus = vi.fn().mockResolvedValue({ encrypted: false })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Encryption is not available')
  })
})
