import { describe, it, expect } from 'vitest'
import { appendToSegments, displaySpeaker, formatSegments, removeTrailingText, transcriptSpeakers } from '../lib/transcript'

describe('transcript segments', () => {
  it('should merge consecutive pieces from the same speaker', () => {
    let segs = appendToSegments([], 'A', 'Hello there.')
    segs = appendToSegments(segs, 'A', 'How are you?')
    segs = appendToSegments(segs, 'You', 'Fine.')
    expect(segs).toEqual([{ speaker: 'A', text: 'Hello there. How are you?' }, { speaker: 'You', text: 'Fine.' }])
  })

  it('should format with labels and custom names', () => {
    const segs = [{ speaker: 'A', text: 'Budget?' }, { speaker: 'You', text: 'Ten.' }, { speaker: 'B', text: 'Ok.' }]
    expect(formatSegments(segs)).toBe('A: Budget?\nYou: Ten.\nB: Ok.')
    expect(formatSegments(segs, { A: 'Maria' })).toBe('Maria: Budget?\nYou: Ten.\nB: Ok.')
    expect(formatSegments([{ speaker: '', text: 'plain text' }])).toBe('plain text')
  })

  it('should list speakers as displayed, in order of appearance', () => {
    const segs = [{ speaker: 'A', text: 'x' }, { speaker: 'You', text: 'y' }, { speaker: 'A', text: 'z' }, { speaker: '', text: 'w' }]
    expect(transcriptSpeakers(segs, { A: 'Maria' })).toEqual(['Maria', 'You'])
  })

  it('should fall back to the label for a blank name', () => {
    expect(displaySpeaker('B', { B: '   ' })).toBe('B')
  })

  it('should retract text from the end of the last segment of that speaker', () => {
    const segs = [{ speaker: 'A', text: 'Ship it Friday.' }, { speaker: 'You', text: 'Sure. Ship it Friday.' }]
    expect(removeTrailingText(segs, 'You', 'Ship it Friday.')).toEqual([segs[0], { speaker: 'You', text: 'Sure.' }])
    expect(removeTrailingText([segs[0], { speaker: 'You', text: 'Ship it Friday.' }], 'You', 'Ship it Friday.')).toEqual([segs[0]])
    expect(removeTrailingText(segs, 'A', 'Ship it Friday.')).toBe(segs) // not the last segment's speaker
    expect(removeTrailingText(segs, 'You', 'something else')).toBe(segs)
  })
})
