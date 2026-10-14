import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CompactView } from '../components/CompactView'
import type { ChatMessage } from '../types'

const msg = (role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: Math.random().toString(), role, content, timestamp: Date.now(), ...extra })

describe('CompactView', () => {
  it('should show only the latest suggestion', () => {
    render(<CompactView
      messages={[msg('user', 'q1'), msg('assistant', 'Old answer'), msg('user', 'q2'), msg('assistant', 'Say **yes** to Friday')]}
      isStreaming={false} onExpand={vi.fn()} shortcutLabel="Cmd+Shift+M"
    />)
    expect(screen.getByText('yes').tagName).toBe('STRONG')
    expect(screen.queryByText('Old answer')).toBeNull()
    expect(screen.queryByText('q2')).toBeNull()
  })

  it('should show a hint before the first suggestion and the reasoning tail while thinking', () => {
    const { rerender } = render(<CompactView messages={[]} isStreaming={false} onExpand={vi.fn()} shortcutLabel="Cmd+Shift+M" />)
    expect(screen.getByText(/Suggestions appear here/)).toBeInTheDocument()
    rerender(<CompactView
      messages={[msg('assistant', '', { isStreaming: true, thinking: 'line 1\nline 2\nweighing the deadline' })]}
      isStreaming={true} onExpand={vi.fn()} shortcutLabel="Cmd+Shift+M"
    />)
    expect(screen.getByText('line 2 weighing the deadline')).toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('should let clicks through except over its toolbar', () => {
    const { unmount } = render(<CompactView messages={[]} isStreaming={false} onExpand={vi.fn()} shortcutLabel="Cmd+Shift+M" />)
    expect(window.ghostAPI.setIgnoreMouse).toHaveBeenLastCalledWith(true)
    const expand = screen.getByTitle('Expand (Cmd+Shift+M)')
    fireEvent.mouseEnter(expand.parentElement!)
    expect(window.ghostAPI.setIgnoreMouse).toHaveBeenLastCalledWith(false)
    fireEvent.mouseLeave(expand.parentElement!)
    expect(window.ghostAPI.setIgnoreMouse).toHaveBeenLastCalledWith(true)
    unmount()
    expect(window.ghostAPI.setIgnoreMouse).toHaveBeenLastCalledWith(false)
  })

  it('should expand', () => {
    const onExpand = vi.fn()
    render(<CompactView messages={[]} isStreaming={false} onExpand={onExpand} shortcutLabel="Cmd+Shift+M" />)
    fireEvent.click(screen.getByTitle('Expand (Cmd+Shift+M)'))
    expect(onExpand).toHaveBeenCalled()
  })
})
