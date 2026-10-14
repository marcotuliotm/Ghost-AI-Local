import { describe, it, expect } from 'vitest'
import { EchoFilter, isEcho, normalizeWords, textSimilarity } from '../lib/echo'

describe('echo detection', () => {
  it('should normalize case, accents and punctuation', () => {
    expect(normalizeWords('Você vai, AMANHÃ?')).toEqual(['voce', 'vai', 'amanha'])
  })

  it('should treat a partial, differently punctuated repeat as echo', () => {
    expect(textSimilarity('We should ship the release on Friday.', 'should ship the release on friday')).toBe(1)
    expect(isEcho('ship the release on friday', 'We should ship the release on Friday, right?')).toBe(true)
  })

  it('should not flag different sentences or very short ones', () => {
    expect(isEcho('I think the budget is fine', 'We should ship on Friday')).toBe(false)
    expect(isEcho('okay yes', 'okay yes')).toBe(false)
  })

  it('should match the other channel only within the time window', () => {
    const f = new EchoFilter(8000)
    f.record('system', 'Can you send the draft by Friday?', 1000)
    expect(f.match('system', 'can you send the draft by friday', 3000)).toBe('Can you send the draft by Friday?')
    expect(f.match('system', 'can you send the draft by friday', 20000)).toBeNull()
  })

  it('should forget a retracted text and reset', () => {
    const f = new EchoFilter()
    f.record('mic', 'send the draft by friday', 0)
    f.forget('mic', 'send the draft by friday')
    expect(f.match('mic', 'send the draft by friday please', 100)).toBeNull()
    f.record('mic', 'another long sentence here', 0)
    f.reset()
    expect(f.match('mic', 'another long sentence here', 100)).toBeNull()
  })
})
