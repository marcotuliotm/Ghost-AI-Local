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

  it('should keep a session deleted in History deleted and save only what comes after', async () => {
    const q1 = msg({ id: 'q1', content: 'first question' })
    const { rerender } = render({ messages: [q1], transcript: 'You: before' })
    flush()
    await act(async () => {})
    const firstId = saved()[0].id
    // Deleted in History: the store now refuses that id
    vi.mocked(window.ghostAPI.sessionsSave).mockResolvedValueOnce({ success: false, deleted: true })
    const q2 = msg({ id: 'q2', content: 'after deleting' })
    rerender({ ...base, messages: [q1, q2], transcript: 'You: before\nYou: after' })
    flush()
    await act(async () => {}) // the refused save resolves
    rerender({ ...base, messages: [q1, q2, msg({ id: 'a2', role: 'assistant', content: 'reply' })], transcript: 'You: before\nYou: after' })
    flush()
    await act(async () => {})
    const last = saved().at(-1)!
    expect(last.id).not.toBe(firstId)
    expect(last.messages.map(m => m.content)).toEqual(['after deleting', 'reply'])
    expect(last.transcript).toBe('You: after')
    expect(JSON.stringify(last)).not.toContain('first question')
  })

  describe('generated titles', () => {
    const ollama = { baseUrl: 'http://localhost:11434', contextLength: 8192 }
    const long = (n: number) => `You: ${'budget talk '.repeat(n)}`.trim()
    const titleCalls = () => vi.mocked(window.ghostAPI.ollamaChat).mock.calls

    it('should title the session from the conversation and save it again', async () => {
      vi.mocked(window.ghostAPI.ollamaChat).mockResolvedValueOnce({ success: true, message: { role: 'assistant', content: '"Marketing budget review."' } })
      render({ transcript: long(20), ollama })
      flush()
      await act(async () => {})
      expect(titleCalls()).toHaveLength(1)
      expect(titleCalls()[0][0]).toMatchObject({ model: 'qwen3.5:latest', think: false, options: { num_ctx: 8192 } })
      expect(titleCalls()[0][0].messages[1].content).toContain('Transcript:\nYou: budget talk')
      const [quick, titled] = saved()
      expect(quick.title).toMatch(/^budget talk/)
      expect(titled).toMatchObject({ id: quick.id, title: 'Marketing budget review', transcript: quick.transcript })
    })

    it('should keep the generated title and renew it only when the text doubles', async () => {
      vi.mocked(window.ghostAPI.ollamaChat).mockResolvedValueOnce({ success: true, message: { role: 'assistant', content: 'Budget review' } })
      const { rerender } = render({ transcript: long(20), ollama })
      flush()
      await act(async () => {})
      rerender({ ...base, ollama, transcript: long(25) })
      flush()
      await act(async () => {})
      expect(titleCalls()).toHaveLength(1)
      expect(saved().at(-1)!.title).toBe('Budget review')
      vi.mocked(window.ghostAPI.ollamaChat).mockResolvedValueOnce({ success: true, message: { role: 'assistant', content: 'Budget and hiring plan' } })
      rerender({ ...base, ollama, transcript: long(45) })
      flush()
      await act(async () => {})
      expect(titleCalls()).toHaveLength(2)
      expect(saved().at(-1)!.title).toBe('Budget and hiring plan')
    })

    it('should not ask for short sessions or while Ollama is unreachable', async () => {
      const { rerender } = render({ transcript: 'You: hi', ollama })
      flush()
      rerender({ ...base, ollama: null, transcript: long(20) })
      flush()
      await act(async () => {})
      expect(titleCalls()).toHaveLength(0)
      expect(saved().at(-1)!.title).toMatch(/^budget talk/)
    })

    it('should keep the quick title when Ollama fails', async () => {
      vi.mocked(window.ghostAPI.ollamaChat).mockResolvedValueOnce({ success: false, error: 'down' })
      render({ messages: [msg({ content: 'How do I answer the budget question?' }), msg({ id: 'a', role: 'assistant', content: 'x'.repeat(200) })], ollama })
      flush()
      await act(async () => {})
      expect(saved()).toHaveLength(1)
      expect(saved()[0].title).toBe('How do I answer the budget question?')
    })

    it('should not save a title that arrives after saving was turned off', async () => {
      let resolve!: (v: Awaited<ReturnType<typeof window.ghostAPI.ollamaChat>>) => void
      vi.mocked(window.ghostAPI.ollamaChat).mockReturnValueOnce(new Promise(r => { resolve = r }))
      const { rerender } = render({ transcript: long(20), ollama })
      flush()
      rerender({ ...base, enabled: false, ollama, transcript: long(20) })
      await act(async () => { resolve({ success: true, message: { role: 'assistant', content: 'Late title' } }) })
      expect(saved()).toHaveLength(1)
    })
  })
})
