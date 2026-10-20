import { useCallback, useEffect, useState } from 'react'
import type { ChatMessage, Settings } from '../types'
import { MessageBubble } from './MessageBubble'
import { sessionMarkdown, type Session, type SessionSummary } from '../lib/sessions'
import { notesDocument } from '../lib/notes'
import { fileStamp } from '../lib/filename'

interface HistoryPanelProps {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  onBack: () => void
}

const SEARCH_DELAY_MS = 200

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function summaryLine(s: SessionSummary): string {
  return [
    s.messageCount > 0 && `${s.messageCount} message${s.messageCount === 1 ? '' : 's'}`,
    s.hasTranscript && 'transcript',
    s.hasNotes && 'notes',
  ].filter(Boolean).join(' · ')
}

function BackButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} className="p-1 rounded hover:bg-ghost-fill-strong transition-colors no-drag" title={title}>
      <svg className="w-4 h-4 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  )
}

/**
 * Saved sessions (transcript, chat and meeting notes), searchable by text.
 * Saving is opt-in (off by default); files stay in userData/sessions.
 */
export function HistoryPanel({ settings, updateSettings, onBack }: HistoryPanelProps) {
  const [query, setQuery] = useState('')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState<Session | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [encrypted, setEncrypted] = useState<boolean | null>(null)

  useEffect(() => {
    window.ghostAPI.sessionsStatus().then(s => setEncrypted(s.encrypted)).catch(() => setEncrypted(null))
  }, [])

  const refresh = useCallback(async (q: string) => {
    try {
      setSessions((await window.ghostAPI.sessionsSearch(q)).sessions)
    } catch { /* keep the current list */ }
    setLoaded(true)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => refresh(query), query ? SEARCH_DELAY_MS : 0)
    return () => clearTimeout(timer)
  }, [query, refresh])

  const openSession = async (id: string) => {
    const { session } = await window.ghostAPI.sessionsGet(id)
    if (session) setOpen(session)
  }

  const deleteSession = async (id: string) => {
    await window.ghostAPI.sessionsDelete(id)
    setOpen(null)
    await refresh(query)
  }

  const deleteAll = async () => {
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true)
      return
    }
    setConfirmDeleteAll(false)
    await window.ghostAPI.sessionsDeleteAll()
    await refresh(query)
  }

  const exportSession = async (s: Session) => {
    const { date, time } = fileStamp(new Date(s.startedAt))
    await window.ghostAPI.saveConversation({ content: sessionMarkdown(s), suggestedName: `session_${date}_${time}.md`, format: 'md' })
  }

  const saveNotes = (s: Session, timestamp: number) => async (markdown: string) => {
    const { date, time } = fileStamp(new Date(timestamp))
    await window.ghostAPI.saveConversation({
      content: notesDocument(markdown, { date: new Date(timestamp), model: s.model, preset: s.preset }),
      suggestedName: `meeting_notes_${date}_${time}.md`,
      format: 'md',
    })
  }

  if (open) {
    const bubbles: ChatMessage[] = open.messages.map((m, i) => ({
      id: `${open.id}-${i}`,
      role: m.role,
      content: m.hadScreenshot ? `${m.content}\n\n_(screenshot not kept in history)_` : m.content,
      timestamp: m.timestamp,
      kind: m.kind,
      sources: m.sources,
      stopped: m.stopped,
      notice: m.notice,
    }))
    return (
      <div className="w-full h-full flex flex-col glass rounded-xl overflow-hidden animate-fade-in" data-testid="history-session">
        <div className="flex items-center justify-between gap-2 pl-[78px] pr-4 py-3 border-b border-ghost-border drag-region">
          <div className="flex items-center gap-2 min-w-0">
            <BackButton onClick={() => setOpen(null)} title="Back to history" />
            <span className="text-sm font-medium text-ghost-text truncate" title={open.title}>{open.title}</span>
          </div>
          <div className="flex items-center gap-1 no-drag flex-shrink-0">
            <button
              onClick={() => exportSession(open)}
              className="px-2 py-0.5 rounded text-[10px] bg-ghost-fill text-ghost-text hover:bg-ghost-fill-strong transition-colors"
            >
              Export .md
            </button>
            <button
              onClick={() => deleteSession(open.id)}
              className="px-2 py-0.5 rounded text-[10px] bg-ghost-fill text-ghost-error hover:bg-ghost-fill-strong transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 no-drag">
          <p className="text-[9px] text-ghost-text-muted">
            {formatDate(open.startedAt)}{open.model && ` · ${open.model}`}{open.preset && ` · ${open.preset}`}
          </p>
          {open.transcript.trim() && (
            <details className="bg-ghost-fill rounded-lg px-2 py-1.5" open={open.messages.length === 0}>
              <summary className="text-[10px] text-ghost-text-muted cursor-pointer select-none">Transcript</summary>
              <pre className="mt-1 text-[10px] text-ghost-text whitespace-pre-wrap font-sans select-text max-h-64 overflow-y-auto">{open.transcript.trim()}</pre>
            </details>
          )}
          {bubbles.map(m => (
            <MessageBubble key={m.id} message={m} onSaveNotes={saveNotes(open, m.timestamp)} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col glass rounded-xl overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between pl-[78px] pr-4 py-3 border-b border-ghost-border drag-region">
        <div className="flex items-center gap-2">
          <BackButton onClick={onBack} title="Back" />
          <span className="text-sm font-medium text-ghost-text">History</span>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-ghost-text cursor-pointer no-drag">
          <input
            type="checkbox"
            checked={settings.saveSessions}
            onChange={e => updateSettings({ saveSessions: e.target.checked })}
            className="accent-ghost-accent"
          />
          Save sessions
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 no-drag">
        {encrypted === false && (
          <p className="text-[10px] text-ghost-error leading-relaxed" role="alert">
            Encryption is not available on this system, so sessions are not saved.
          </p>
        )}

        {!settings.saveSessions && (
          <p className="text-[10px] text-ghost-warning leading-relaxed">
            Saving is off: nothing from your conversations is kept after you clear them or quit. Turn on "Save sessions" to keep the transcript, chat and meeting notes of each session on this machine, encrypted.
          </p>
        )}

        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search sessions..."
          aria-label="Search sessions"
          className="w-full bg-ghost-fill border border-ghost-border rounded-lg px-2 py-1 text-xs text-ghost-text placeholder:text-ghost-text-muted focus:outline-none focus:border-ghost-accent"
        />

        {loaded && sessions.length === 0 ? (
          <p className="text-[10px] text-ghost-text-muted opacity-70 italic">
            {query ? 'No sessions match.' : 'No saved sessions.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sessions.map(s => (
              <li key={s.id}>
                <button
                  onClick={() => openSession(s.id)}
                  className="w-full text-left bg-ghost-fill hover:bg-ghost-fill-strong rounded-lg px-2 py-1.5 transition-colors"
                >
                  <div className="text-xs text-ghost-text truncate" title={s.title}>{s.title}</div>
                  <div className="text-[9px] text-ghost-text-muted">
                    {formatDate(s.startedAt)}{summaryLine(s) && ` · ${summaryLine(s)}`}
                  </div>
                  {s.snippet && <div className="mt-0.5 text-[9px] text-ghost-text-muted opacity-80 line-clamp-2">{s.snippet}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {sessions.length > 0 && !query && (
          <div className="border-t border-ghost-border pt-3 flex items-center gap-2">
            <button
              onClick={deleteAll}
              onBlur={() => setConfirmDeleteAll(false)}
              className="px-2 py-0.5 rounded text-[10px] bg-ghost-fill text-ghost-error hover:bg-ghost-fill-strong transition-colors"
            >
              {confirmDeleteAll ? 'Click again to delete all' : 'Delete all sessions'}
            </button>
            <span className="text-[9px] text-ghost-text-muted opacity-70">Encrypted on this machine, never uploaded.</span>
          </div>
        )}
      </div>
    </div>
  )
}
