import { useState, useEffect, useRef, useCallback } from 'react'
import type { Settings } from '../types'
import {
  composeTranscriptContext,
  estimateTokens,
  planCompaction,
  promptBudget,
  SUMMARY_SHARE,
  TRANSCRIPT_COMPACT_SHARE,
} from '../lib/context'

// After a failed summary request, wait before trying again so a down/busy
// Ollama isn't hit on every transcript update.
const RETRY_DELAY_MS = 30_000

/**
 * Progressive transcript summary. While the unsummarized transcript fits in
 * ~40% of the prompt budget it is sent verbatim. Past that, the older part is
 * folded into a running summary in the background (via ollamaChat) and only the
 * recent part stays verbatim. `getContext()` returns what to send right now.
 */
export function useTranscriptContext(transcript: string, settings: Settings, isConnected: boolean) {
  // `summary` covers exactly `prefix`, the start of the transcript. If the
  // transcript no longer starts with it (Clear / new recording) both are dropped.
  const [{ summary, prefix }, setSummaryState] = useState({ summary: '', prefix: '' })
  const [isSummarizing, setIsSummarizing] = useState(false)
  const inFlightRef = useRef(false)
  const retryAtRef = useRef(0)
  // Bumped on reset so a summary that finishes after a Clear is discarded.
  const generationRef = useRef(0)

  const budget = promptBudget(settings.contextLength)

  // Reset when the transcript stops extending the summarized prefix.
  useEffect(() => {
    if (prefix && !transcript.startsWith(prefix)) {
      generationRef.current++
      setSummaryState({ summary: '', prefix: '' })
    }
  }, [transcript, prefix])

  // Fold the older transcript into the summary when it outgrows its share.
  useEffect(() => {
    if (!isConnected || inFlightRef.current || Date.now() < retryAtRef.current) return
    if (!transcript.startsWith(prefix)) return // reset pending
    const end = planCompaction(transcript, prefix.length, budget)
    if (end === null) return

    const chunk = transcript.slice(prefix.length, end)
    const generation = generationRef.current
    const maxSummaryWords = Math.max(80, Math.floor(budget * SUMMARY_SHARE * 0.75))
    inFlightRef.current = true
    setIsSummarizing(true)

    window.ghostAPI.ollamaChat({
      model: settings.selectedModel,
      baseUrl: settings.ollamaBaseUrl,
      options: { num_ctx: settings.contextLength },
      // Background bookkeeping: reasoning would only delay it (and block Ollama)
      think: false,
      messages: [
        {
          role: 'system',
          content: `You maintain a running summary of a live conversation transcript. Merge the new transcript excerpt into the existing summary. Keep who said what (speaker labels: "You" is the user; A, B, C or "Other" are other participants), decisions, open questions, names, numbers and commitments. Drop filler. Write in English, as concise bullet points, at most ${maxSummaryWords} words. Reply with ONLY the updated summary.`,
        },
        {
          role: 'user',
          content: `Existing summary:\n${summary.trim() || '(none yet)'}\n\nNew transcript excerpt:\n${chunk}`,
        },
      ],
    }).then(result => {
      if (generation !== generationRef.current) return
      const text = result.success ? result.message?.content?.trim() : ''
      if (!text) {
        retryAtRef.current = Date.now() + RETRY_DELAY_MS
        return
      }
      setSummaryState({ summary: text, prefix: transcript.slice(0, end) })
    }).catch(() => {
      retryAtRef.current = Date.now() + RETRY_DELAY_MS
    }).finally(() => {
      inFlightRef.current = false
      setIsSummarizing(false)
    })
  }, [transcript, prefix, summary, budget, isConnected, settings.selectedModel, settings.ollamaBaseUrl, settings.contextLength])

  const getContext = useCallback((): string => {
    if (!transcript.trim()) return ''
    const valid = transcript.startsWith(prefix)
    const recent = valid ? transcript.slice(prefix.length) : transcript
    const sum = valid ? summary : ''
    // Summary + verbatim part get the compaction share, plus the summary's own allowance.
    const maxTokens = Math.floor(budget * TRANSCRIPT_COMPACT_SHARE) + (sum ? estimateTokens(sum) : 0)
    return composeTranscriptContext(sum, recent, maxTokens)
  }, [transcript, summary, prefix, budget])

  return { getContext, summary, isSummarizing }
}
