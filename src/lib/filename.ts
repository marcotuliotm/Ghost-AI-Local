import type { Settings } from '../types'
import { cleanTitle } from './sessions'

// Date/time stamps used in saved file names and headers: 2026-05-25, 14h30
export function fileStamp(now: Date): { date: string; time: string } {
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5).replace(':', 'h'),
  }
}

// Turn a model reply into a safe snake_case file stem (or '' if unusable).
export function sanitizeFilename(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  return name.length > 2 ? name : ''
}

/**
 * Ask Ollama for a 2-4 word file name describing `text` (a `what` like
 * "conversation" or "meeting" steers the wording). Returns null when Ollama is
 * unreachable or the reply is unusable, so callers keep their timestamp name.
 */
export async function suggestFilename(
  settings: Pick<Settings, 'selectedModel' | 'ollamaBaseUrl'>,
  text: string,
  what: string,
): Promise<string | null> {
  try {
    const result = await window.ghostAPI.ollamaChat({
      model: settings.selectedModel,
      baseUrl: settings.ollamaBaseUrl,
      // A file name needs no reasoning; on thinking models this takes ~1s instead of minutes
      think: false,
      messages: [
        {
          role: 'system',
          content: `Generate a very short filename (2-4 words, no spaces use underscores, lowercase, no extension, no special chars, english) that describes the topic of this ${what}. Reply with ONLY the filename, nothing else.`,
        },
        { role: 'user', content: text },
      ],
    })
    if (!result.success || !result.message?.content) return null
    return sanitizeFilename(result.message.content) || null
  } catch {
    return null
  }
}

/**
 * Ask Ollama for a short title saying what a session is about, in the
 * conversation's language (`source` from `titleSource`). Null when Ollama is
 * unreachable or the reply is unusable, so the session keeps its quick title.
 */
export async function suggestSessionTitle(
  ollama: { model: string; baseUrl: string; contextLength: number },
  source: string,
): Promise<string | null> {
  try {
    const result = await window.ghostAPI.ollamaChat({
      model: ollama.model,
      baseUrl: ollama.baseUrl,
      // Same window as the chat, so Ollama doesn't reload the model for this call
      options: { num_ctx: ollama.contextLength },
      think: false,
      messages: [
        {
          role: 'system',
          content: 'Write a short title (3-7 words) saying what this conversation is about, in the same language as the conversation. Reply with ONLY the title: no quotes, no prefix, no final period.',
        },
        { role: 'user', content: source },
      ],
    })
    if (!result.success || !result.message?.content) return null
    return cleanTitle(result.message.content) || null
  } catch {
    return null
  }
}
