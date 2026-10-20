import type { OllamaMessage } from '../types'

// Context-window management for Ollama requests.
//
// Everything here is a pure function so it can be unit-tested without Ollama.
// Token counts are estimates: we don't ship a tokenizer, and ~4 chars/token is
// a conservative average for English with Llama/Gemma-style tokenizers. The
// budget leaves headroom for that error plus the model's reply.

const CHARS_PER_TOKEN = 4
// Per-message overhead for role markers / chat-template tokens.
const MESSAGE_OVERHEAD_TOKENS = 4
// Images are encoded into a fixed-ish number of tokens by vision models
// (Gemma ~256, LLaVA ~576). Use the larger value to stay safe.
const IMAGE_TOKENS = 768

// Share of the prompt budget the live transcript may take before the older
// part gets summarized, and how much literal recent transcript survives a pass.
export const TRANSCRIPT_COMPACT_SHARE = 0.4
export const TRANSCRIPT_KEEP_SHARE = 0.15
// Upper bound on the summary itself, as a share of the prompt budget.
export const SUMMARY_SHARE = 0.1

// What the last request used of the prompt budget (title-bar indicator)
export interface ContextUsage {
  promptTokens: number // estimated tokens sent (system + transcript + history + message)
  budget: number // promptBudget(contextLength)
  contextLength: number
  droppedMessages: number // older chat messages left out to fit
}

// Share of the budget used, 0-1 (can exceed 1 when one message alone is too big)
export function usageRatio(usage: ContextUsage): number {
  return usage.budget > 0 ? usage.promptTokens / usage.budget : 0
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateMessageTokens(msg: OllamaMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateTokens(msg.content) + (msg.images?.length ?? 0) * IMAGE_TOKENS
}

// Room kept for the reply. A thinking model writes its reasoning into the same
// window before answering — qwen3.5 measured ~3,200 reasoning tokens for a
// transcript summary — and with KV-cache shifting unavailable Ollama stops at
// num_ctx: an over-full prompt then leaves an empty answer. So reasoning gets
// up to half the window (max 4096); otherwise a quarter (max 2048).
export const REPLY_RESERVE = 2048
export const REASONING_REPLY_RESERVE = 4096

// Tokens available for the prompt once the reply (and reasoning) has room.
export function promptBudget(contextLength: number, reasoning = false): number {
  const reserve = reasoning
    ? Math.min(REASONING_REPLY_RESERVE, Math.floor(contextLength * 0.5))
    : Math.min(REPLY_RESERVE, Math.floor(contextLength * 0.25))
  return Math.max(0, contextLength - reserve)
}

/**
 * Keep the newest messages that fit in `budgetTokens`. Messages are dropped
 * whole, oldest first, so the history never starts mid-message. The last
 * message (the one being sent) is always kept even if it alone is over budget —
 * Ollama will truncate it, which beats sending nothing.
 */
export function fitHistoryToBudget(messages: OllamaMessage[], budgetTokens: number): OllamaMessage[] {
  if (messages.length === 0) return []
  const kept: OllamaMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i])
    if (kept.length > 0 && used + cost > budgetTokens) break
    kept.unshift(messages[i])
    used += cost
  }
  // Don't open the history with an orphaned assistant reply whose question was cut.
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift()
  return kept
}

/**
 * Text added to `full` since `previous` was taken from it. The transcript only
 * grows by appending, so `previous` is normally a prefix of `full`; if it isn't
 * (the transcript was cleared or restarted) the whole of `full` is new.
 */
export function transcriptDelta(full: string, previous: string): string {
  if (!previous) return full.trim()
  if (full.startsWith(previous)) return full.slice(previous.length).trim()
  return full.trim()
}

/**
 * Index into `text` where a cut leaves roughly `maxTokens` after it. The cut is
 * moved forward to the next line break (speaker turn) or, failing that, the next
 * space, so the tail never starts mid-word.
 */
export function tailStartIndex(text: string, maxTokens: number): number {
  const maxChars = Math.max(0, Math.floor(maxTokens * CHARS_PER_TOKEN))
  if (text.length <= maxChars) return 0
  let start = text.length - maxChars
  // Prefer a turn boundary within the first 40% of the window.
  const newline = text.indexOf('\n', start)
  if (newline !== -1 && newline - start < maxChars * 0.4) return newline + 1
  const space = text.indexOf(' ', start)
  if (space !== -1 && space < text.length - 1) start = space + 1
  return start
}

// The most recent part of the transcript that fits in `maxTokens`.
export function transcriptTail(text: string, maxTokens: number): string {
  return text.slice(tailStartIndex(text, maxTokens)).trim()
}

/**
 * Decide whether the unsummarized part of the transcript (from `summarizedLen`
 * on) has outgrown its share of the budget. Returns the end index of the chunk
 * to fold into the summary, or null when nothing needs compacting. A single pass
 * folds at most `maxChunkTokens`, so a long backlog (e.g. Ollama was busy) is
 * worked off over several passes instead of one request that overflows num_ctx.
 */
export function planCompaction(
  transcript: string,
  summarizedLen: number,
  budgetTokens: number,
  maxChunkTokens = Math.floor(budgetTokens * 0.5),
): number | null {
  const pending = transcript.slice(summarizedLen)
  if (estimateTokens(pending) <= budgetTokens * TRANSCRIPT_COMPACT_SHARE) return null

  const keepFrom = summarizedLen + tailStartIndex(pending, budgetTokens * TRANSCRIPT_KEEP_SHARE)
  let end = keepFrom
  const maxEnd = summarizedLen + Math.floor(maxChunkTokens * CHARS_PER_TOKEN)
  if (end > maxEnd) {
    // Snap the capped end back to a word boundary.
    const space = transcript.lastIndexOf(' ', maxEnd)
    end = space > summarizedLen ? space + 1 : maxEnd
  }
  return end > summarizedLen ? end : null
}

/**
 * The transcript context sent with a request: the running summary of older
 * speech plus the recent part verbatim. If summarization is lagging behind (or
 * Ollama failed), the verbatim part is still capped so the request fits.
 */
export function composeTranscriptContext(summary: string, recent: string, maxTokens: number): string {
  const parts: string[] = []
  const trimmedSummary = summary.trim()
  let remaining = maxTokens
  if (trimmedSummary) {
    parts.push(`Summary of the earlier part of the conversation:\n${trimmedSummary}`)
    remaining -= estimateTokens(parts[0])
  }
  const tail = transcriptTail(recent, Math.max(0, remaining))
  if (tail) {
    parts.push(trimmedSummary ? `Most recent transcript (verbatim):\n${tail}` : tail)
  }
  return parts.join('\n\n')
}

// Wrap the transcript context as a system message. Speaker labels come from
// AudioCapture: "You" is the user's mic; A/B/C/Other (or names the user gave
// them) are the other side.
export function transcriptSystemMessage(context: string): OllamaMessage | null {
  if (!context.trim()) return null
  return {
    role: 'system',
    content: `Live transcript of the conversation the user is in (when labeled, each line starts with who is speaking: "You" is the user; any other label (a name, or A, B, C, "Other") is another participant). Use it as context for your answers:\n\n${context}`,
  }
}
