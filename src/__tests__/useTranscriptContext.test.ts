import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useTranscriptContext } from '../hooks/useTranscriptContext'
import type { Settings } from '../types'
import { makeSettings } from './fixtures'

const settings: Settings = makeSettings({
  ollamaBaseUrl: 'http://localhost:11434',
  selectedModel: 'gemma4:latest',
  systemPrompt: 'You are Ghost AI.',
  suggestReplyPrompt: '{{transcript}}',
  opacity: 0.9,
  fontSize: 12,
  transcriptionInterval: 10,
  speakerThreshold: 0.85,
  contextLength: 4096, // prompt budget 3072 → compaction above ~1229 tokens (~4900 chars)
})

const longTranscript = (n: number, prefix = 'A') =>
  Array.from({ length: n }, (_, i) => `${prefix}: sentence number ${i} about the project plan.`).join('\n')

describe('useTranscriptContext', () => {
  it('should return the transcript verbatim while it is short', () => {
    const { result } = renderHook(() => useTranscriptContext('A: hello\nYou: hi', settings, true))
    expect(result.current.getContext()).toBe('A: hello\nYou: hi')
    expect(window.ghostAPI.ollamaChat).not.toHaveBeenCalled()
  })

  it('should return empty context for an empty transcript', () => {
    const { result } = renderHook(() => useTranscriptContext('', settings, true))
    expect(result.current.getContext()).toBe('')
  })

  it('should summarize the older part once the transcript outgrows its share', async () => {
    window.ghostAPI.ollamaChat = vi.fn().mockResolvedValue({
      success: true,
      message: { role: 'assistant', content: '- A walked through the project plan' },
    })
    const transcript = longTranscript(150) // ~7000 chars
    const { result } = renderHook(() => useTranscriptContext(transcript, settings, true))

    await waitFor(() => expect(result.current.summary).toBe('- A walked through the project plan'))

    const call = (window.ghostAPI.ollamaChat as any).mock.calls[0][0]
    expect(call.options).toEqual({ num_ctx: 4096 })
    expect(call.think).toBe(false) // background summary never waits on reasoning
    expect(call.messages[1].content).toContain('sentence number 0 ')

    const ctx = result.current.getContext()
    expect(ctx).toContain('A walked through the project plan')
    // Recent lines stay verbatim; the oldest are only in the summary
    expect(ctx).toContain('sentence number 149 ')
    expect(ctx).not.toContain('sentence number 0 ')
  })

  it('should not summarize while disconnected', () => {
    renderHook(() => useTranscriptContext(longTranscript(150), settings, false))
    expect(window.ghostAPI.ollamaChat).not.toHaveBeenCalled()
  })

  it('should still cap the verbatim context when summarization fails', async () => {
    window.ghostAPI.ollamaChat = vi.fn().mockResolvedValue({ success: false, error: 'busy' })
    const transcript = longTranscript(400)
    const { result } = renderHook(() => useTranscriptContext(transcript, settings, true))
    await waitFor(() => expect(window.ghostAPI.ollamaChat).toHaveBeenCalled())

    const ctx = result.current.getContext()
    expect(ctx.length).toBeLessThan(transcript.length / 2)
    expect(ctx).toContain('sentence number 399 ')
  })

  it('should drop the summary when the transcript is cleared', async () => {
    window.ghostAPI.ollamaChat = vi.fn().mockResolvedValue({
      success: true,
      message: { role: 'assistant', content: '- old meeting summary' },
    })
    const { result, rerender } = renderHook(
      ({ t }) => useTranscriptContext(t, settings, true),
      { initialProps: { t: longTranscript(150) } },
    )
    await waitFor(() => expect(result.current.summary).toBe('- old meeting summary'))

    rerender({ t: 'B: a new meeting' })
    await waitFor(() => expect(result.current.summary).toBe(''))
    expect(result.current.getContext()).toBe('B: a new meeting')
  })
})
