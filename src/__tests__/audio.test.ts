import { describe, it, expect } from 'vitest'
import { hasAudioEnergy, isHallucination } from '../lib/audio'

describe('audio helpers', () => {
  it('should treat near-silence as no energy', () => {
    expect(hasAudioEnergy(new Float32Array(1600))).toBe(false)
    expect(hasAudioEnergy(Float32Array.from({ length: 1600 }, (_, i) => 0.1 * Math.sin(i / 5)))).toBe(true)
  })

  it('should filter Whisper hallucinations on silence', () => {
    for (const t of ['you', 'Thank you.', 'Thanks for watching', '...', 'um', 'ok']) expect(isHallucination(t), t).toBe(true)
    expect(isHallucination('We should ship on Friday.')).toBe(false)
  })
})
