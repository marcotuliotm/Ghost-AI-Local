import { describe, it, expect } from 'vitest'
import {
  composeTranscriptContext,
  estimateMessageTokens,
  estimateTokens,
  fitHistoryToBudget,
  planCompaction,
  promptBudget,
  tailStartIndex,
  transcriptDelta,
  transcriptSystemMessage,
  transcriptTail,
  TRANSCRIPT_COMPACT_SHARE,
} from '../lib/context'
import type { OllamaMessage } from '../types'

const msg = (role: OllamaMessage['role'], content: string): OllamaMessage => ({ role, content })

describe('estimateTokens', () => {
  it('should be zero for empty text', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('should estimate ~4 chars per token, rounding up', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    expect(estimateTokens('x'.repeat(400))).toBe(100)
  })

  it('should charge images a fixed cost per message', () => {
    const plain = estimateMessageTokens(msg('user', 'hi'))
    const withImage = estimateMessageTokens({ role: 'user', content: 'hi', images: ['abc'] })
    expect(withImage - plain).toBeGreaterThanOrEqual(256)
  })
})

describe('promptBudget', () => {
  it('should reserve a quarter of small windows for the reply', () => {
    expect(promptBudget(4096)).toBe(3072)
  })

  it('should cap the reply reserve at 2048 tokens', () => {
    expect(promptBudget(32768)).toBe(32768 - 2048)
  })
})

describe('fitHistoryToBudget', () => {
  it('should keep everything when it fits', () => {
    const history = [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')]
    expect(fitHistoryToBudget(history, 1000)).toEqual(history)
  })

  it('should drop the oldest messages first', () => {
    const history = [
      msg('user', 'one '.repeat(100)),
      msg('assistant', 'two '.repeat(100)),
      msg('user', 'three '.repeat(100)),
      msg('assistant', 'four '.repeat(100)),
      msg('user', 'five'),
    ]
    const kept = fitHistoryToBudget(history, 300)
    expect(kept.at(-1)!.content).toBe('five')
    expect(kept.some(m => m.content.startsWith('one'))).toBe(false)
    expect(kept.reduce((n, m) => n + estimateMessageTokens(m), 0)).toBeLessThanOrEqual(300)
  })

  it('should always keep the last message even when it alone exceeds the budget', () => {
    const history = [msg('user', 'old'), msg('user', 'x'.repeat(10_000))]
    const kept = fitHistoryToBudget(history, 100)
    expect(kept).toHaveLength(1)
    expect(kept[0].content).toHaveLength(10_000)
  })

  it('should not start the history with an orphaned assistant reply', () => {
    const history = [
      msg('user', 'q1 '.repeat(200)),
      msg('assistant', 'a1'),
      msg('user', 'q2'),
    ]
    const kept = fitHistoryToBudget(history, 50)
    expect(kept[0].role).toBe('user')
    expect(kept.map(m => m.content)).toEqual(['q2'])
  })

  it('should return an empty list for empty history', () => {
    expect(fitHistoryToBudget([], 100)).toEqual([])
  })
})

describe('transcriptDelta', () => {
  it('should return the whole transcript when nothing was sent yet', () => {
    expect(transcriptDelta('A: hello', '')).toBe('A: hello')
  })

  it('should return only the appended text', () => {
    expect(transcriptDelta('A: hello there\nYou: hi', 'A: hello there')).toBe('You: hi')
  })

  it('should return text appended to the same speaker paragraph', () => {
    expect(transcriptDelta('A: hello how are you', 'A: hello')).toBe('how are you')
  })

  it('should return empty when nothing changed', () => {
    expect(transcriptDelta('A: hello', 'A: hello')).toBe('')
  })

  it('should return the whole transcript after it was cleared and restarted', () => {
    expect(transcriptDelta('B: new meeting', 'A: old meeting text')).toBe('B: new meeting')
  })
})

describe('transcriptTail / tailStartIndex', () => {
  it('should return short text unchanged', () => {
    expect(transcriptTail('A: short', 100)).toBe('A: short')
    expect(tailStartIndex('A: short', 100)).toBe(0)
  })

  it('should fit within the token budget', () => {
    const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    const tail = transcriptTail(text, 50)
    expect(estimateTokens(tail)).toBeLessThanOrEqual(50)
    expect(text.endsWith(tail)).toBe(true)
  })

  it('should not start mid-word', () => {
    const text = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    const tail = transcriptTail(text, 50)
    expect(tail).toMatch(/^word\d+/)
    expect(text).toContain(` ${tail.split(' ')[0]} `)
  })

  it('should prefer starting at a speaker turn', () => {
    const text = `A: ${'blah '.repeat(100)}\nYou: ${'yes '.repeat(20)}`
    const tail = transcriptTail(text, 30)
    expect(tail.startsWith('You:')).toBe(true)
  })
})

describe('planCompaction', () => {
  const budget = 1000 // tokens → compaction above 400 tokens (~1600 chars)

  it('should do nothing while the transcript fits its share', () => {
    expect(planCompaction('A: hi '.repeat(100), 0, budget)).toBeNull()
  })

  it('should fold the older part and keep the recent tail verbatim', () => {
    const transcript = 'word '.repeat(600) // ~750 tokens
    const end = planCompaction(transcript, 0, budget, 10_000)!
    expect(end).toBeGreaterThan(0)
    const kept = transcript.slice(end)
    expect(estimateTokens(kept)).toBeLessThanOrEqual(budget * 0.15)
    expect(estimateTokens(kept)).toBeGreaterThan(0)
    // Cut on a word boundary
    expect(transcript[end - 1]).toBe(' ')
  })

  it('should only consider text after the summarized prefix', () => {
    const transcript = 'old '.repeat(2000) + 'new '.repeat(10)
    expect(planCompaction(transcript, transcript.length - 40, budget)).toBeNull()
  })

  it('should cap a single pass so a large backlog is folded in pieces', () => {
    const transcript = 'word '.repeat(5000) // ~6250 tokens
    const end = planCompaction(transcript, 0, budget, 500)!
    expect(estimateTokens(transcript.slice(0, end))).toBeLessThanOrEqual(500)
    // Next pass continues from there
    const next = planCompaction(transcript, end, budget, 500)!
    expect(next).toBeGreaterThan(end)
  })

  it('should trigger exactly above the compaction share', () => {
    const atLimit = 'x'.repeat(budget * TRANSCRIPT_COMPACT_SHARE * 4)
    expect(planCompaction(atLimit, 0, budget)).toBeNull()
    expect(planCompaction(atLimit + ' more words here', 0, budget)).not.toBeNull()
  })
})

describe('composeTranscriptContext', () => {
  it('should return the verbatim transcript when there is no summary', () => {
    expect(composeTranscriptContext('', 'A: hi\nYou: hello', 100)).toBe('A: hi\nYou: hello')
  })

  it('should put the summary before the recent verbatim part', () => {
    const ctx = composeTranscriptContext('- They discussed the budget', 'A: and the deadline?', 200)
    expect(ctx.indexOf('discussed the budget')).toBeLessThan(ctx.indexOf('and the deadline?'))
    expect(ctx).toContain('Summary of the earlier part')
    expect(ctx).toContain('Most recent transcript')
  })

  it('should cap the verbatim part when summarization lags behind', () => {
    const recent = 'word '.repeat(2000)
    const ctx = composeTranscriptContext('', recent, 100)
    expect(estimateTokens(ctx)).toBeLessThanOrEqual(100)
  })

  it('should return empty for an empty transcript', () => {
    expect(composeTranscriptContext('', '', 100)).toBe('')
  })
})

describe('transcriptSystemMessage', () => {
  it('should wrap context in a system message', () => {
    const m = transcriptSystemMessage('A: hello')!
    expect(m.role).toBe('system')
    expect(m.content).toContain('A: hello')
  })

  it('should return null for empty context', () => {
    expect(transcriptSystemMessage('  ')).toBeNull()
  })
})
