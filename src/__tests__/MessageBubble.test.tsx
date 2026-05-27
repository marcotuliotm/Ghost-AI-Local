import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
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

  describe('timestamp', () => {
    it('should format and display timestamp', () => {
      const timestamp = new Date('2024-06-15T14:30:00').getTime()
      render(<MessageBubble message={createMessage({ timestamp })} />)
      // The formatted time depends on locale, just check something is rendered
      const timeElement = screen.getByText(/\d{2}:\d{2}/)
      expect(timeElement).toBeInTheDocument()
    })
  })
})
