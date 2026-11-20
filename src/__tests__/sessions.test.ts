import { describe, it, expect } from 'vitest'
import {
  AI_TITLE_MIN_CHARS,
  cleanTitle,
  foldText,
  hasSessionContent,
  isValidSessionId,
  sanitizeSession,
  searchSessions,
  sessionContentSize,
  sessionMarkdown,
  sessionTitle,
  shouldRetitle,
  titleSource,
  toSessionMessages,
  type Session,
} from '../lib/sessions'
import type { ChatMessage } from '../types'

const ID = '0b6a8f4e-3c2d-4e1f-9a8b-7c6d5e4f3a2b'
const ID2 = '1b6a8f4e-3c2d-4e1f-9a8b-7c6d5e4f3a2b'

const session = (over: Partial<Session> = {}): Session => ({
  id: ID, startedAt: 1_000, updatedAt: 2_000, title: 'Budget call', model: 'qwen3.5:latest', preset: 'General',
  transcript: 'Maria: a reunião de orçamento é sexta\nYou: ok', messages: [], ...over,
})

const msg = (over: Partial<ChatMessage>): ChatMessage => ({ id: 'm', role: 'user', content: 'hi', timestamp: 1, ...over })

describe('session ids', () => {
  it('should only accept UUIDs (they become file names)', () => {
    expect(isValidSessionId(ID)).toBe(true)
    expect(isValidSessionId('../settings')).toBe(false)
    expect(isValidSessionId(`${ID}/../x`)).toBe(false)
    expect(isValidSessionId(42)).toBe(false)
  })
})

describe('toSessionMessages', () => {
  it('should drop screenshots, reasoning, system and empty messages', () => {
    const out = toSessionMessages([
      msg({ role: 'system', content: 'sys' }),
      msg({ content: 'What is this?', screenshot: 'data:image/png;base64,AAAA' }),
      msg({ role: 'assistant', content: 'A chart', thinking: 'long reasoning', sources: ['cv.pdf'] }),
      msg({ role: 'assistant', content: '  ', isStreaming: true }),
      msg({ role: 'assistant', content: '## Summary', kind: 'notes' }),
    ])
    expect(out).toEqual([
      { role: 'user', content: 'What is this?', timestamp: 1, hadScreenshot: true },
      { role: 'assistant', content: 'A chart', timestamp: 1, sources: ['cv.pdf'] },
      { role: 'assistant', content: '## Summary', timestamp: 1, kind: 'notes' },
    ])
    expect(JSON.stringify(out)).not.toContain('base64')
    expect(JSON.stringify(out)).not.toContain('reasoning')
  })

  it('should tell when there is anything to save', () => {
    expect(hasSessionContent([], '')).toBe(false)
    expect(hasSessionContent([msg({ role: 'system' })], '  ')).toBe(false)
    expect(hasSessionContent([], 'You: hi')).toBe(true)
    expect(hasSessionContent([msg({})], '')).toBe(true)
  })
})

describe('sessionTitle', () => {
  it('should use the first question, else the transcript without the speaker label', () => {
    expect(sessionTitle([{ role: 'assistant', content: 'x', timestamp: 0 }, { role: 'user', content: 'How do I\nanswer?', timestamp: 0 }], '')).toBe('How do I answer?')
    expect(sessionTitle([], 'Maria: let us start with the budget\nYou: ok')).toBe('let us start with the budget')
    expect(sessionTitle([], '')).toBe('Untitled session')
    expect(sessionTitle([{ role: 'user', content: 'a'.repeat(100), timestamp: 0 }], '')).toHaveLength(60)
  })
})

describe('generated titles', () => {
  const user = (content: string) => ({ role: 'user' as const, content, timestamp: 0 })
  const answer = (content: string, kind?: 'notes') => ({ role: 'assistant' as const, content, timestamp: 0, ...(kind ? { kind } : {}) })

  it('should ask for a title once there is enough text, then each time it doubles', () => {
    expect(shouldRetitle(AI_TITLE_MIN_CHARS - 1, 0)).toBe(false)
    expect(shouldRetitle(AI_TITLE_MIN_CHARS, 0)).toBe(true)
    expect(shouldRetitle(300, 200)).toBe(false)
    expect(shouldRetitle(400, 200)).toBe(true)
    expect(sessionContentSize([user(' ab '), answer('cde')], '  You: hi ')).toBe(12)
  })

  it('should read the latest meeting notes when there are any', () => {
    const source = titleSource([user('q'), answer('old notes', 'notes'), answer('## Summary\nBudget review', 'notes')], 'You: hi')
    expect(source).toBe('Meeting notes:\n## Summary\nBudget review')
  })

  it('should read the questions and the transcript, or the first answer without one', () => {
    expect(titleSource([user('How do I\nanswer?'), answer('Say yes')], 'Maria: hello')).toBe('Questions asked:\n- How do I answer?\n\nTranscript:\nMaria: hello')
    expect(titleSource([user('What is on screen?'), answer('A login form')], '')).toBe('Questions asked:\n- What is on screen?\n\nAnswer:\nA login form')
  })

  it('should keep the beginning and the end of long text', () => {
    const source = titleSource([], `You: START ${'x'.repeat(5000)} END`, 1000)
    expect(source.length).toBeLessThanOrEqual(1000)
    expect(source).toContain('START')
    expect(source).toContain('END')
  })

  it('should clean the model reply into a title', () => {
    expect(cleanTitle('"Revisão do orçamento de marketing."')).toBe('Revisão do orçamento de marketing')
    expect(cleanTitle('\nTitle: **System design interview**\nextra')).toBe('System design interview')
    expect(cleanTitle('# Título: Entrevista técnica')).toBe('Entrevista técnica')
    expect(cleanTitle('  ')).toBe('')
    expect(cleanTitle('a'.repeat(100))).toHaveLength(60)
  })
})

describe('sanitizeSession', () => {
  it('should accept a valid session and reject malformed ones', () => {
    expect(sanitizeSession(session())).toEqual(session())
    expect(sanitizeSession({ ...session(), id: '../../etc' })).toBeNull()
    expect(sanitizeSession({ ...session(), startedAt: 'x' })).toBeNull()
    expect(sanitizeSession(null)).toBeNull()
  })

  it('should keep only the known message fields (never a screenshot or reasoning)', () => {
    const s = sanitizeSession({ ...session(), messages: [
      { role: 'user', content: 'Look', timestamp: 1, screenshot: 'data:image/png;base64,AAAA', hadScreenshot: true, extra: 1 },
      { role: 'assistant', content: 'ok', timestamp: 2, thinking: 'secret', sources: ['cv.pdf', 3], kind: 'notes', stopped: 'yes' },
    ] })
    expect(s?.messages).toEqual([
      { role: 'user', content: 'Look', timestamp: 1, hadScreenshot: true },
      { role: 'assistant', content: 'ok', timestamp: 2, sources: ['cv.pdf'], kind: 'notes' },
    ])
  })

  it('should drop invalid messages and fill missing strings', () => {
    const s = sanitizeSession({ id: ID, startedAt: 1, updatedAt: 1, messages: [{ role: 'system', content: 'x', timestamp: 1 }, { role: 'user', content: 'ok', timestamp: 1 }, 'junk'] })
    expect(s?.messages).toEqual([{ role: 'user', content: 'ok', timestamp: 1 }])
    expect(s?.title).toBe('Untitled session')
    expect(s?.transcript).toBe('')
  })
})

describe('searchSessions', () => {
  const sessions = [
    session(),
    session({ id: ID2, updatedAt: 3_000, title: 'Interview', transcript: '', messages: [{ role: 'assistant', content: 'Talk about the React migration you led.', timestamp: 0 }] }),
  ]

  it('should list everything newest first for an empty query', () => {
    expect(searchSessions(sessions, '  ').map(s => s.id)).toEqual([ID2, ID])
  })

  it('should match all words, ignoring case and accents, with a snippet that keeps them', () => {
    const [hit] = searchSessions(sessions, 'REUNIAO sexta')
    expect(hit.id).toBe(ID)
    expect(hit.snippet).toContain('reunião de orçamento')
    expect(searchSessions(sessions, 'reunião react')).toEqual([])
    expect(searchSessions(sessions, 'react')[0]).toMatchObject({ id: ID2, messageCount: 1, hasTranscript: false })
  })

  it('should cut long snippets around the match', () => {
    const long = session({ transcript: `${'x '.repeat(200)}needle${' y'.repeat(200)}` })
    const snippet = searchSessions([long], 'needle')[0].snippet!
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet.length).toBeLessThan(160)
  })

  it('should fold accents', () => {
    expect(foldText('Ação É')).toBe('acao e')
  })
})

describe('sessionMarkdown', () => {
  it('should export the transcript and the chat', () => {
    const md = sessionMarkdown(session({
      messages: [
        { role: 'user', content: 'Look', timestamp: 0, hadScreenshot: true },
        { role: 'assistant', content: '## Summary\nShipped.', timestamp: 0, kind: 'notes' },
      ],
    }))
    expect(md).toContain('# Budget call')
    expect(md).toContain('Model: qwen3.5:latest · Preset: General')
    expect(md).toContain('## Transcript\n\nMaria: a reunião de orçamento é sexta')
    expect(md).toContain('**You** _(with screenshot)_\n\nLook')
    expect(md).toContain('**Ghost AI (meeting notes)**\n\n## Summary')
  })
})
