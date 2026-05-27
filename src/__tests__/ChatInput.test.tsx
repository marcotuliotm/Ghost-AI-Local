import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ChatInput } from '../components/ChatInput'

describe('ChatInput', () => {
  const defaultProps = {
    onSend: vi.fn(),
    isStreaming: false,
    isConnected: true,
    isCompact: false,
  }

  describe('rendering', () => {
    it('should show default placeholder when connected', () => {
      render(<ChatInput {...defaultProps} />)
      expect(screen.getByPlaceholderText('Ask something... (Cmd+Shift+A)')).toBeInTheDocument()
    })

    it('should show disconnected placeholder when not connected', () => {
      render(<ChatInput {...defaultProps} isConnected={false} />)
      expect(screen.getByPlaceholderText('Ollama disconnected...')).toBeInTheDocument()
    })

    it('should show streaming placeholder when streaming', () => {
      render(<ChatInput {...defaultProps} isStreaming={true} />)
      expect(screen.getByPlaceholderText('Generating response...')).toBeInTheDocument()
    })

    it('should disable input when not connected', () => {
      render(<ChatInput {...defaultProps} isConnected={false} />)
      const input = screen.getByPlaceholderText('Ollama disconnected...')
      expect(input).toBeDisabled()
    })

    it('should disable input when streaming', () => {
      render(<ChatInput {...defaultProps} isStreaming={true} />)
      const input = screen.getByPlaceholderText('Generating response...')
      expect(input).toBeDisabled()
    })

    it('should disable submit button when input is empty', () => {
      render(<ChatInput {...defaultProps} />)
      const button = screen.getByTitle('Send')
      expect(button).toBeDisabled()
    })
  })

  describe('sending messages', () => {
    it('should call onSend with trimmed input on submit', async () => {
      const onSend = vi.fn()
      render(<ChatInput {...defaultProps} onSend={onSend} />)

      const input = screen.getByPlaceholderText('Ask something... (Cmd+Shift+A)')
      await userEvent.type(input, '  hello world  ')
      fireEvent.submit(input.closest('form')!)

      expect(onSend).toHaveBeenCalledWith('hello world')
    })

    it('should clear input after sending', async () => {
      render(<ChatInput {...defaultProps} />)

      const input = screen.getByPlaceholderText('Ask something... (Cmd+Shift+A)') as HTMLInputElement
      await userEvent.type(input, 'hello')
      fireEvent.submit(input.closest('form')!)

      expect(input.value).toBe('')
    })

    it('should not send empty message', async () => {
      const onSend = vi.fn()
      render(<ChatInput {...defaultProps} onSend={onSend} />)

      const input = screen.getByPlaceholderText('Ask something... (Cmd+Shift+A)')
      fireEvent.submit(input.closest('form')!)

      expect(onSend).not.toHaveBeenCalled()
    })

    it('should not send whitespace-only message', async () => {
      const onSend = vi.fn()
      render(<ChatInput {...defaultProps} onSend={onSend} />)

      const input = screen.getByPlaceholderText('Ask something... (Cmd+Shift+A)')
      await userEvent.type(input, '   ')
      fireEvent.submit(input.closest('form')!)

      expect(onSend).not.toHaveBeenCalled()
    })

    it('should not send when streaming', async () => {
      const onSend = vi.fn()
      render(<ChatInput {...defaultProps} onSend={onSend} isStreaming={true} />)

      const input = screen.getByPlaceholderText('Generating response...')
      // Input is disabled, so we set value directly
      fireEvent.change(input, { target: { value: 'hello' } })
      fireEvent.submit(input.closest('form')!)

      expect(onSend).not.toHaveBeenCalled()
    })

    it('should not send when disconnected', async () => {
      const onSend = vi.fn()
      render(<ChatInput {...defaultProps} onSend={onSend} isConnected={false} />)

      const input = screen.getByPlaceholderText('Ollama disconnected...')
      fireEvent.change(input, { target: { value: 'hello' } })
      fireEvent.submit(input.closest('form')!)

      expect(onSend).not.toHaveBeenCalled()
    })
  })

  describe('keyboard shortcuts', () => {
    it('should clear input on Escape', async () => {
      render(<ChatInput {...defaultProps} />)

      const input = screen.getByPlaceholderText('Ask something... (Cmd+Shift+A)') as HTMLInputElement
      await userEvent.type(input, 'hello')
      expect(input.value).toBe('hello')

      fireEvent.keyDown(input, { key: 'Escape' })
      expect(input.value).toBe('')
    })
  })
})
