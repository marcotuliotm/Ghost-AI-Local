import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useAutoSend } from '../hooks/useAutoSend'

afterEach(() => vi.useRealTimers())

describe('useAutoSend', () => {
  it('should send only the new text on each tick while active', () => {
    vi.useFakeTimers()
    let transcript = 'A: hello'
    const send = vi.fn()
    const { result } = renderHook(() => useAutoSend(true, () => transcript, send))
    act(() => result.current.setEnabled(true))

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(send).toHaveBeenLastCalledWith('A: hello')

    transcript = 'A: hello\nB: and the deadline?'
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(send).toHaveBeenLastCalledWith('B: and the deadline?')

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(send).toHaveBeenCalledTimes(2) // nothing new
  })

  it('should retry text the parent declined', () => {
    vi.useFakeTimers()
    const send = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    const { result } = renderHook(() => useAutoSend(true, () => 'A: busy?', send))
    act(() => result.current.setEnabled(true))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(send.mock.calls).toEqual([['A: busy?'], ['A: busy?']])
  })

  it('should not tick while inactive or disabled, and skip what was marked sent', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const { result, rerender } = renderHook(({ active }) => useAutoSend(active, () => 'A: hi', send), { initialProps: { active: false } })
    act(() => result.current.setEnabled(true))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(send).not.toHaveBeenCalled()

    act(() => result.current.markSent('A: hi'))
    rerender({ active: true })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(send).not.toHaveBeenCalled()
  })

  it('should keep the interval within 10-120s', () => {
    const { result } = renderHook(() => useAutoSend(true, () => '', vi.fn()))
    act(() => { for (let i = 0; i < 10; i++) result.current.changeInterval(-5) })
    expect(result.current.intervalSec).toBe(10)
    act(() => { for (let i = 0; i < 30; i++) result.current.changeInterval(5) })
    expect(result.current.intervalSec).toBe(120)
  })
})
