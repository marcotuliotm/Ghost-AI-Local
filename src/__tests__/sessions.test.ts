import { describe, it, expect } from 'vitest'
import {
  foldText,
  hasSessionContent,
  isValidSessionId,
  sanitizeSession,
  searchSessions,
  sessionMarkdown,
  sessionTitle,
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

describe('sanitizeSession', () => {
  it('should accept a valid session and reject malformed ones', () => {
    expect(sanitizeSession(session())).toEqual(session())
    expect(sanitizeSession({ ...session(), id: '../../etc' })).toBeNull()
    expect(sanitizeSession({ ...session(), startedAt: 'x' })).toBeNull()
    expect(sanitizeSession(null)).toBeNull()
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
