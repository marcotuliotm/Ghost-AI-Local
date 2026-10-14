import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MAX_QUEUED_SEGMENTS, useTranscriptionQueue, type QueuedSegment } from '../hooks/useTranscriptionQueue'

const seg = (n: number): QueuedSegment => ({ channel: 'system', audio: new Float32Array([n]), sampleRate: 16000, endedAt: n })

describe('useTranscriptionQueue', () => {
  it('should process segments one at a time, in order', async () => {
    const order: number[] = []
    let running = 0
    let maxRunning = 0
    const process = vi.fn(async (s: QueuedSegment) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise(r => setTimeout(r, 5))
      order.push(s.audio[0])
      running--
    })
    const { result } = renderHook(() => useTranscriptionQueue(process))
    await act(async () => {
      result.current.enqueue(seg(1))
      result.current.enqueue(seg(2))
      result.current.enqueue(seg(3))
      await result.current.drain()
    })
    expect(order).toEqual([1, 2, 3])
    expect(maxRunning).toBe(1)
    expect(result.current.isTranscribing).toBe(false)
  })

  it('should keep going after a failed segment', async () => {
    const process = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useTranscriptionQueue(process))
    await act(async () => {
      result.current.enqueue(seg(1))
      result.current.enqueue(seg(2))
      await result.current.drain()
    })
    expect(process).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('should drop the oldest segments when Whisper falls behind', async () => {
    let release: () => void = () => {}
    const seen: number[] = []
    const process = vi.fn(async (s: QueuedSegment) => {
      seen.push(s.audio[0])
      if (s.audio[0] === 0) await new Promise<void>(r => { release = r })
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useTranscriptionQueue(process))
    await act(async () => {
      result.current.enqueue(seg(0)) // blocks the queue
      for (let i = 1; i <= MAX_QUEUED_SEGMENTS + 5; i++) result.current.enqueue(seg(i))
      release()
      await result.current.drain()
    })
    expect(seen).toHaveLength(MAX_QUEUED_SEGMENTS + 1)
    expect(seen[1]).toBe(6) // segments 1-5 were dropped
    warn.mockRestore()
  })
})
