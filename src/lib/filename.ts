import type { Settings } from '../types'

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
