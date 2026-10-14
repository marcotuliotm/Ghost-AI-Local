import { describe, it, expect } from 'vitest'
import { SpeakerClusterer } from '../lib/diarization'

const unit = (v: number[]) => { const n = Math.hypot(...v); return v.map(x => x / n) }

describe('SpeakerClusterer', () => {
  it('should group similar voices and split different ones', () => {
    const c = new SpeakerClusterer()
    expect(c.assign(unit([1, 0, 0]))).toBe('A')
    expect(c.assign(unit([0.98, 0.1, 0]))).toBe('A')
    expect(c.assign(unit([0, 1, 0]))).toBe('B')
    expect(c.assign(unit([0.05, 0.99, 0]))).toBe('B')
    expect(c.assign(unit([0, 0, 1]))).toBe('C')
    expect(c.speakerCount).toBe(3)
  })

  it('should follow the threshold', () => {
    const loose = new SpeakerClusterer()
    loose.assign(unit([1, 0.3, 0]))
    expect(loose.assign(unit([1, -0.3, 0]), 0.7)).toBe('A')
    const strict = new SpeakerClusterer()
    strict.assign(unit([1, 0.3, 0]))
    expect(strict.assign(unit([1, -0.3, 0]), 0.95)).toBe('B')
  })

  it('should label a missing embedding Other and restart at A after reset', () => {
    const c = new SpeakerClusterer()
    expect(c.assign(null)).toBe('Other')
    c.assign(unit([1, 0]))
    c.reset()
    expect(c.assign(unit([0, 1]))).toBe('A')
  })
})
