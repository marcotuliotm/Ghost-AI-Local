import { useCallback, useEffect, useState } from 'react'
import type { Settings } from '../types'
import { findModel, type DocumentInfo } from '../lib/rag'

interface DocumentsPanelProps {
  settings: Settings
  embeddingModels: string[] // local Ollama embedding models
  isConnected: boolean
  updateSettings: (patch: Partial<Settings>) => void
  onBack: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The user's documents (CV, job description, agenda, notes...) whose relevant
 * excerpts are sent with each request. Files are read and indexed locally;
 * semantic search uses a local Ollama embedding model when one is installed,
 * keyword search otherwise.
 */
export function DocumentsPanel({ settings, embeddingModels, isConnected, updateSettings, onBack }: DocumentsPanelProps) {
  const [docs, setDocs] = useState<DocumentInfo[]>([])
  const [busy, setBusy] = useState<'' | 'adding' | 'reindexing'>('')
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([])

  const installed = findModel(embeddingModels.map(name => ({ name })), settings.embeddingModel)?.name ?? null
  const needsReindex = installed !== null && docs.some(d => d.embeddingModel !== installed)
  const opts = { baseUrl: settings.ollamaBaseUrl, embeddingModel: settings.embeddingModel }

  const refresh = useCallback(async () => {
    try {
      setDocs((await window.ghostAPI.docsList()).docs)
    } catch { /* keep the current list */ }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleAdd = async () => {
    setBusy('adding')
    setErrors([])
    try {
      const res = await window.ghostAPI.docsAdd(opts)
      setErrors(res.errors ?? [])
      await refresh()
    } finally {
      setBusy('')
    }
  }

  const handleReindex = async () => {
    setBusy('reindexing')
    try {
      const res = await window.ghostAPI.docsReindex(opts)
      if (res.error) setErrors([{ name: 'Semantic search', error: res.error }])
      await refresh()
    } finally {
      setBusy('')
    }
  }

  const toggle = async (doc: DocumentInfo) => setDocs((await window.ghostAPI.docsSetEnabled(doc.id, !doc.enabled)).docs)
  const remove = async (doc: DocumentInfo) => setDocs((await window.ghostAPI.docsRemove(doc.id)).docs)

  return (
    <div className="w-full h-full flex flex-col glass overflow-hidden animate-fade-in">
      <div className="toolbar">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-1 rounded hover:bg-ghost-fill-strong transition-colors no-drag" title="Back">
            <svg className="w-4 h-4 text-ghost-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-body font-semibold text-ghost-text">Documents</span>
        </div>
        <button
          onClick={handleAdd}
          disabled={busy !== ''}
          className="px-3 py-1 rounded-full bg-ghost-accent hover:bg-ghost-accent-hover text-body text-white transition-colors no-drag disabled:opacity-40"
        >
          {busy === 'adding' ? 'Adding...' : 'Add'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 no-drag">
        <p className="text-callout text-ghost-text-muted leading-relaxed">
          Add your CV, a job description, an agenda or notes (.pdf, .txt, .md). The most relevant excerpts of the documents that are on go along with each question, Suggest reply and Auto request. Files are read and indexed on this machine only.
        </p>

        {docs.length === 0 ? (
          <p className="text-callout text-ghost-text-muted opacity-70 italic">No documents yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {docs.map(doc => (
              <li key={doc.id} className="flex items-center gap-2 bg-ghost-fill rounded-lg px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={doc.enabled}
                  onChange={() => toggle(doc)}
                  aria-label={`Use ${doc.name}`}
                  className="accent-ghost-accent"
                />
                <div className="flex-1 min-w-0">
                  <div className={`text-body truncate ${doc.enabled ? 'text-ghost-text' : 'text-ghost-text-muted line-through'}`} title={doc.name}>
                    {doc.name}
                  </div>
                  <div className="text-subhead text-ghost-text-muted">
                    {formatSize(doc.size)} · {doc.chunkCount} excerpt{doc.chunkCount === 1 ? '' : 's'} · {doc.embeddingModel ? 'semantic + keyword' : 'keyword'}
                  </div>
                </div>
                <button
                  onClick={() => remove(doc)}
                  className="p-1 rounded text-ghost-text-muted hover:text-ghost-error hover:bg-ghost-fill-strong transition-colors"
                  title={`Remove ${doc.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {errors.length > 0 && (
          <div className="space-y-0.5" role="alert">
            {errors.map((e, i) => (
              <p key={i} className="text-callout text-ghost-error">{e.name}: {e.error}</p>
            ))}
          </div>
        )}

        <div className="border-t border-ghost-border pt-3 space-y-1.5">
          <div className="text-body text-ghost-text">Semantic search</div>
          {installed ? (
            <>
              <p className="text-callout text-ghost-text-muted">
                Using <code className="bg-ghost-fill-strong px-1 rounded">{installed}</code> (local) to match by meaning, combined with keyword search.
              </p>
              {needsReindex && (
                <button
                  onClick={handleReindex}
                  disabled={busy !== ''}
                  className="px-2 py-0.5 rounded-full text-callout bg-ghost-fill text-ghost-text hover:bg-ghost-fill-strong transition-colors disabled:opacity-40"
                >
                  {busy === 'reindexing' ? 'Indexing...' : 'Index existing documents'}
                </button>
              )}
            </>
          ) : (
            <p className="text-callout text-ghost-text-muted leading-relaxed">
              {isConnected ? 'Keyword search only.' : 'Ollama is not connected — keyword search only.'} For matching by meaning, install a local embedding model: <code className="bg-ghost-fill-strong px-1 rounded select-text">ollama pull {settings.embeddingModel}</code>
            </p>
          )}
          {embeddingModels.length > 1 && (
            <select
              aria-label="Embedding model"
              value={installed ?? ''}
              onChange={e => updateSettings({ embeddingModel: e.target.value })}
              className="w-full bg-ghost-fill border border-ghost-border rounded-lg px-2 py-1 text-callout text-ghost-text focus:outline-none focus:border-ghost-accent appearance-none"
            >
              {embeddingModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
      </div>
    </div>
  )
}
