import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MessageBubble } from '../components/MessageBubble'
import type { ChatMessage } from '../types'

const createMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'test-id',
  role: 'user',
  content: 'Hello world',
  timestamp: new Date('2024-06-15T14:30:00').getTime(),
  ...overrides,
})

describe('MessageBubble', () => {
  describe('user messages', () => {
    it('should show "You" label for user messages', () => {
      render(<MessageBubble message={createMessage({ role: 'user' })} />)
      expect(screen.getByText('You')).toBeInTheDocument()
    })

    it('should show message content', () => {
      render(<MessageBubble message={createMessage({ content: 'Test message' })} />)
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })

    it('should align user messages to the right', () => {
      const { container } = render(<MessageBubble message={createMessage({ role: 'user' })} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('justify-end')
    })
  })

  describe('assistant messages', () => {
    it('should show "Ghost" label for assistant messages', () => {
      render(<MessageBubble message={createMessage({ role: 'assistant' })} />)
      expect(screen.getByText('Ghost')).toBeInTheDocument()
    })

    it('should not align assistant messages to the right', () => {
      const { container } = render(<MessageBubble message={createMessage({ role: 'assistant' })} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).not.toContain('justify-end')
    })
  })

  describe('streaming', () => {
    it('should show "typing..." when streaming', () => {
      render(<MessageBubble message={createMessage({ role: 'assistant', isStreaming: true, content: 'partial' })} />)
      expect(screen.getByText('typing...')).toBeInTheDocument()
    })

    it('should show "Thinking" when streaming with empty content', () => {
      render(<MessageBubble message={createMessage({ role: 'assistant', isStreaming: true, content: '' })} />)
      expect(screen.getByText('Thinking')).toBeInTheDocument()
    })

    it('should not show "typing..." when not streaming', () => {
      render(<MessageBubble message={createMessage({ role: 'assistant', content: 'done' })} />)
      expect(screen.queryByText('typing...')).not.toBeInTheDocument()
    })
  })

  describe('screenshot', () => {
    it('should show screenshot image when present', () => {
      render(
        <MessageBubble
          message={createMessage({ screenshot: 'data:image/png;base64,abc123' })}
        />
      )
      const img = screen.getByAltText('Screenshot')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123')
    })

    it('should not show screenshot when not present', () => {
      render(<MessageBubble message={createMessage()} />)
      expect(screen.queryByAltText('Screenshot')).not.toBeInTheDocument()
    })
  })

  describe('copy button', () => {
    it('should copy the message content via the native clipboard when clicked', async () => {
      render(<MessageBubble message={createMessage({ content: 'Copy me', isStreaming: false })} />)
      fireEvent.click(screen.getByTitle('Copy message'))

      expect(window.ghostAPI.copyText).toHaveBeenCalledWith('Copy me')
      await waitFor(() => expect(screen.getByTitle('Copied!')).toBeInTheDocument())
    })

    it('should fall back to the web clipboard when ghostAPI is unavailable', async () => {
      const original = window.ghostAPI
      ;(window as any).ghostAPI = undefined
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      render(<MessageBubble message={createMessage({ content: 'Web copy', isStreaming: false })} />)
      fireEvent.click(screen.getByTitle('Copy message'))

      expect(writeText).toHaveBeenCalledWith('Web copy')
      await waitFor(() => expect(screen.getByTitle('Copied!')).toBeInTheDocument())
      ;(window as any).ghostAPI = original
    })

    it('should not render the copy button while streaming', () => {
      render(<MessageBubble message={createMessage({ content: 'partial', isStreaming: true })} />)
      expect(screen.queryByTitle('Copy message')).not.toBeInTheDocument()
    })
  })

  describe('timestamp', () => {
    it('should format and display timestamp', () => {
      const timestamp = new Date('2024-06-15T14:30:00').getTime()
      render(<MessageBubble message={createMessage({ timestamp })} />)
      // The formatted time depends on locale, just check something is rendered
      const timeElement = screen.getByText(/\d{2}:\d{2}/)
      expect(timeElement).toBeInTheDocument()
    })
  })

  describe('meeting notes', () => {
    const notes = { id: 'n', role: 'assistant' as const, content: '## Summary\nDone.', timestamp: Date.now(), kind: 'notes' as const }

    it('should offer Save .md on a finished notes reply', () => {
      const onSaveNotes = vi.fn()
      render(<MessageBubble message={notes} onSaveNotes={onSaveNotes} />)
      fireEvent.click(screen.getByTitle('Save notes to a .md file'))
      expect(onSaveNotes).toHaveBeenCalledWith('## Summary\nDone.')
    })

    it('should show progress and ignore repeat clicks while saving', async () => {
      let finish: () => void = () => {}
      const onSaveNotes = vi.fn().mockReturnValue(new Promise<void>(r => { finish = r }))
      render(<MessageBubble message={notes} onSaveNotes={onSaveNotes} />)
      fireEvent.click(screen.getByText('Save .md'))
      expect(await screen.findByText('Saving...')).toBeInTheDocument()
      fireEvent.click(screen.getByText('Saving...'))
      expect(onSaveNotes).toHaveBeenCalledTimes(1)
      finish()
      expect(await screen.findByText('Save .md')).toBeInTheDocument()
    })

    it('should not offer Save .md while streaming or on other replies', () => {
      const onSaveNotes = vi.fn()
      const { rerender } = render(<MessageBubble message={{ ...notes, isStreaming: true }} onSaveNotes={onSaveNotes} />)
      expect(screen.queryByText('Save .md')).toBeNull()
      rerender(<MessageBubble message={{ ...notes, kind: undefined }} onSaveNotes={onSaveNotes} />)
      expect(screen.queryByText('Save .md')).toBeNull()
    })
  })

  describe('markdown', () => {
    const reply = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
      ({ id: 'r', role: 'assistant', content, timestamp: Date.now(), ...extra })

    it('should render headings, lists, tables and task lists', () => {
      const { container } = render(<MessageBubble message={reply(
        '## Plan\n\n- one\n- **two**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] send draft — A',
      )} />)
      expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
      expect(container.querySelector('strong')?.textContent).toBe('two')
      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getByRole('checkbox')).not.toBeChecked()
    })

    it('should highlight code and copy a code block', async () => {
      const { container } = render(<MessageBubble message={reply('```js\nconst x = 1\n```')} />)
      expect(container.querySelector('code.hljs')).toBeInTheDocument()
      fireEvent.click(screen.getByTitle('Copy code'))
      await waitFor(() => expect(window.ghostAPI.copyText).toHaveBeenCalledWith('const x = 1'))
      expect(await screen.findByText('Copied!')).toBeInTheDocument()
    })

    it('should never render live links, images or raw HTML', () => {
      const { container } = render(<MessageBubble message={reply(
        '[site](https://example.com) ![tracker](https://example.com/pixel.png) <img src="https://example.com/x.png">',
      )} />)
      expect(container.querySelector('a')).toBeNull()
      expect(container.querySelector('img')).toBeNull()
      expect(screen.getByText('site')).toHaveAttribute('title', 'https://example.com')
      expect(screen.getByText('[image: tracker]')).toBeInTheDocument()
    })

    it('should keep user messages as typed', () => {
      render(<MessageBubble message={{ id: 'u', role: 'user', content: '## not a heading', timestamp: Date.now() }} />)
      expect(screen.queryByRole('heading')).toBeNull()
      expect(screen.getByText('## not a heading')).toBeInTheDocument()
    })
  })

  describe('reasoning and stop', () => {
    const base: ChatMessage = { id: 'r', role: 'assistant', content: '', timestamp: Date.now() }

    it('should show live reasoning while the model thinks', () => {
      const { container } = render(<MessageBubble message={{ ...base, isStreaming: true, thinking: 'Weighing options' }} />)
      expect(screen.getByText('Reasoning...')).toBeInTheDocument()
      expect(screen.getByText('Weighing options')).toBeInTheDocument()
      expect(container.querySelector('details')).toHaveAttribute('open')
      expect(screen.queryByText('Thinking')).toBeNull()
    })

    it('should collapse the reasoning once the answer arrives', () => {
      const { container } = render(<MessageBubble message={{ ...base, content: 'Answer', thinking: 'Weighing options' }} />)
      expect(screen.getByText('Reasoning')).toBeInTheDocument()
      expect(container.querySelector('details')).not.toHaveAttribute('open')
      expect(screen.getByText('Answer')).toBeInTheDocument()
    })

    it('should mark a stopped reply', () => {
      render(<MessageBubble message={{ ...base, content: 'Partial', stopped: true }} />)
      expect(screen.getByText('Stopped')).toBeInTheDocument()
    })
  })
})
