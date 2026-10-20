import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSessionHistory, SESSION_SAVE_DELAY_MS } from '../hooks/useSessionHistory'
import type { ChatMessage } from '../types'

const msg = (over: Partial<ChatMessage>): ChatMessage => ({ id: 'm', role: 'user', content: 'hi', timestamp: 1, ...over })
type Props = Parameters<typeof useSessionHistory>[0]
const base: Props = { enabled: true, messages: [], transcript: '', model: 'qwen3.5:latest', preset: 'General' }

const render = (props: Partial<Props> = {}) =>
  renderHook((p: Props) => useSessionHistory(p), { initialProps: { ...base, ...props } })

const flush = () => act(() => { vi.advanceTimersByTime(SESSION_SAVE_DELAY_MS) })
const saved = () => vi.mocked(window.ghostAPI.sessionsSave).mock.calls.map(c => c[0])

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useSessionHistory', () => {
  it('should save nothing while saving is off (the default)', () => {
    render({ enabled: false, messages: [msg({ content: 'secret' })], transcript: 'You: secret' })
    flush()
    expect(window.ghostAPI.sessionsSave).not.toHaveBeenCalled()
  })

  it('should save nothing without content', () => {
    render()
    flush()
    expect(window.ghostAPI.sessionsSave).not.toHaveBeenCalled()
  })

  it('should save the session after a pause, updating the same id', () => {
    const { rerender } = render({ transcript: 'You: hello' })
    flush()
    rerender({ ...base, transcript: 'You: hello', messages: [msg({ content: 'How do I answer?' })] })
    flush()
    const [first, second] = saved()
    expect(first).toMatchObject({ transcript: 'You: hello', title: 'hello', model: 'qwen3.5:latest', preset: 'General', messages: [] })
    expect(second.id).toBe(first.id)
    expect(second.startedAt).toBe(first.startedAt)
    expect(second).toMatchObject({ title: 'How do I answer?', messages: [{ role: 'user', content: 'How do I answer?' }] })
  })

  it('should wait for a streaming reply to finish', () => {
    const user = msg({ content: 'q' })
    const { rerender } = render({ messages: [user, msg({ id: 'a', role: 'assistant', content: 'par', isStreaming: true })] })
    flush()
    expect(window.ghostAPI.sessionsSave).not.toHaveBeenCalled()
    rerender({ ...base, messages: [user, msg({ id: 'a', role: 'assistant', content: 'partial answer' })] })
    flush()
    expect(saved()[0].messages[1].content).toBe('partial answer')
  })

  it('should start a new session when the chat or the transcript is cleared', () => {
    const { rerender } = render({ messages: [msg({ content: 'first' })], transcript: 'You: a' })
    flush()
    rerender({ ...base, messages: [], transcript: 'You: a' }) // Clear chat
    flush()
    rerender({ ...base, messages: [], transcript: '' }) // Clear transcript: nothing left to save
    rerender({ ...base, messages: [], transcript: 'You: new call' })
    flush()
    const ids = saved().map(s => s.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(saved()[0].messages).toHaveLength(1) // the first session kept its chat
  })
})
