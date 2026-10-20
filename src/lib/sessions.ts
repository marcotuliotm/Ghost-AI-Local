import type { ChatMessage } from '../types'

// Session history: what a session holds, how it's titled, searched and
// exported. Pure module, shared with the main process (electron/sessions.ts).

// A chat message as kept in history: no screenshot (base64, large), no reasoning
export interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  hadScreenshot?: boolean
  kind?: 'notes'
  sources?: string[]
  stopped?: boolean
  notice?: string
}

export interface Session {
  id: string
  startedAt: number
  updatedAt: number
  title: string
  model: string
  preset: string
  transcript: string // formatted with speaker names ("You: … / Maria: …")
  messages: SessionMessage[]
}

export interface SessionSummary {
  id: string
  startedAt: number
  updatedAt: number
  title: string
  model: string
  preset: string
  messageCount: number
  hasTranscript: boolean
  hasNotes: boolean
  snippet?: string // search match in context
}

const TITLE_CHARS = 60
const SNIPPET_RADIUS = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Session ids become file names: only UUIDs, so a renderer can't reach other paths
export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

export function toSessionMessages(messages: ChatMessage[]): SessionMessage[] {
  return messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system' && Boolean(m.content.trim()))
    .map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      ...(m.screenshot ? { hadScreenshot: true } : {}),
      ...(m.kind ? { kind: m.kind } : {}),
      ...(m.sources?.length ? { sources: m.sources } : {}),
      ...(m.stopped ? { stopped: true } : {}),
      ...(m.notice ? { notice: m.notice } : {}),
    }))
}

function shorten(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

// First thing the user asked, else the first words of the transcript
export function sessionTitle(messages: SessionMessage[], transcript: string): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (firstUser) return shorten(firstUser.content, TITLE_CHARS)
  const firstLine = transcript.trim().split('\n')[0] ?? ''
  if (firstLine) return shorten(firstLine.replace(/^[^:\n]{1,30}:\s*/, ''), TITLE_CHARS)
  return 'Untitled session'
}

export function hasSessionContent(messages: ChatMessage[], transcript: string): boolean {
  return Boolean(transcript.trim()) || toSessionMessages(messages).length > 0
}

export function summarizeSession(s: Session, snippet?: string): SessionSummary {
  return {
    id: s.id,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    title: s.title,
    model: s.model,
    preset: s.preset,
    messageCount: s.messages.length,
    hasTranscript: Boolean(s.transcript.trim()),
    hasNotes: s.messages.some(m => m.kind === 'notes'),
    ...(snippet ? { snippet } : {}),
  }
}

// Validates a session coming from the renderer or from disk (null if malformed)
export function sanitizeSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (!isValidSessionId(s.id) || typeof s.startedAt !== 'number' || typeof s.updatedAt !== 'number') return null
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const messages = Array.isArray(s.messages)
    ? s.messages.filter((m): m is SessionMessage =>
      Boolean(m) && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && typeof m.timestamp === 'number')
    : []
  return {
    id: s.id,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    title: str(s.title) || 'Untitled session',
    model: str(s.model),
    preset: str(s.preset),
    transcript: str(s.transcript),
    messages,
  }
}

// Lower case without accents, so "reuniao" finds "reunião"
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Text around the first match of `query` (already folded) in `text`
function snippetAround(text: string, query: string): string | null {
  // Fold char by char, remembering where each folded char came from, so the
  // snippet is cut from the original text (accents kept)
  let folded = ''
  const origin: number[] = []
  for (let i = 0; i < text.length; i++) {
    const f = foldText(text[i])
    folded += f
    for (let j = 0; j < f.length; j++) origin.push(i)
  }
  const at = folded.indexOf(query)
  if (at < 0) return null
  const matchStart = origin[at]
  const matchEnd = origin[at + query.length - 1] + 1
  const start = Math.max(0, matchStart - SNIPPET_RADIUS)
  const end = Math.min(text.length, matchEnd + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

/**
 * Sessions whose title, transcript or messages contain every word of `query`
 * (case- and accent-insensitive), newest first, each with a snippet of the
 * first word's match. An empty query lists them all.
 */
export function searchSessions(sessions: Session[], query: string): SessionSummary[] {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const words = foldText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return sorted.map(s => summarizeSession(s))
  const results: SessionSummary[] = []
  for (const s of sorted) {
    const fields = [s.title, s.transcript, ...s.messages.map(m => m.content)]
    const haystack = foldText(fields.join('\n'))
    if (!words.every(w => haystack.includes(w))) continue
    let snippet: string | undefined
    for (const field of fields) {
      const found = snippetAround(field, words[0])
      if (found) { snippet = found; break }
    }
    results.push(summarizeSession(s, snippet))
  }
  return results
}

// Markdown export of a whole session (Export .md in the History panel)
export function sessionMarkdown(s: Session): string {
  const when = new Date(s.startedAt).toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const details = [when, s.model && `Model: ${s.model}`, s.preset && `Preset: ${s.preset}`].filter(Boolean).join(' · ')
  const parts = [`# ${s.title}`, `_${details}_`]
  if (s.transcript.trim()) parts.push('## Transcript', s.transcript.trim())
  if (s.messages.length > 0) {
    parts.push('## Chat')
    for (const m of s.messages) {
      const who = m.role === 'user' ? 'You' : m.kind === 'notes' ? 'Ghost AI (meeting notes)' : 'Ghost AI'
      parts.push(`**${who}**${m.hadScreenshot ? ' _(with screenshot)_' : ''}\n\n${m.content.trim()}`)
    }
  }
  return `${parts.join('\n\n')}\n`
}
