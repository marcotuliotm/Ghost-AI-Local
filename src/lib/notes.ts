import { estimateTokens, promptBudget, transcriptTail } from './context'
import { isEnglishOnlyModel, TRANSCRIPTION_LANGUAGES } from './whisper'

// Meeting notes: prompt construction and Markdown export. Pure functions.

export const NOTES_SECTIONS = ['Summary', 'Key decisions', 'Action items', 'Open questions'] as const

// What shows up as the user's chat message; the format lives in the system prompt.
export const NOTES_REQUEST = 'Write meeting notes for this conversation.'

// Per-message chat-template overhead, as in lib/context.ts (system + transcript + user)
const REQUEST_OVERHEAD_TOKENS = 3 * 4

// Speaker labels AudioCapture writes at the start of a line ("You: ", "A: ", "Other: ").
// Fallback when the caller doesn't pass the speakers (custom names aren't detectable).
export function detectSpeakers(transcript: string): string[] {
  const found = new Set<string>()
  for (const m of transcript.matchAll(/^(You|Other|[A-Z]):\s/gm)) found.add(m[1])
  const order = (s: string) => (s === 'You' ? 0 : s === 'Other' ? 2 : 1)
  return [...found].sort((a, b) => order(a) - order(b) || a.localeCompare(b))
}

/**
 * Language the notes should be written in, from the Whisper settings: an
 * English-only model always transcribes English, a chosen language is the
 * conversation's language, and null (Auto-detect) lets the model follow the
 * transcript.
 */
export function notesLanguage(whisperModel: string, transcriptionLanguage: string): string | null {
  if (isEnglishOnlyModel(whisperModel)) return 'English'
  if (transcriptionLanguage === 'auto') return null
  return TRANSCRIPTION_LANGUAGES.find(l => l.id === transcriptionLanguage)?.label ?? null
}

export function meetingNotesInstructions(speakers: string[], language: string | null = null): string {
  const owner = speakers.length > 0
    ? `The owner is the speaker label of whoever is responsible (${speakers.join(', ')}; "You" is the user). Use "Unassigned" when it is unclear.`
    : 'The owner is the person\'s name if it was said, otherwise "Unassigned".'
  return `You write meeting notes from a conversation transcript. When labeled, each line starts with who is speaking: "You" is the user; any other label (a name, or A, B, C, "Other") is another participant.

Reply with ONLY Markdown in exactly this structure — no title, no preamble, no other sections:

## Summary
2-5 sentences on what was discussed and the outcome.

## Key decisions
- One bullet per decision that was made.

## Action items
- [ ] Task — Owner

## Open questions
- Questions raised but not answered.

Action items: one checkbox line per task, formatted exactly "- [ ] task — owner". ${owner}
If a section has nothing, write "- None recorded." under it.
Base everything strictly on the transcript; never invent names, dates or numbers.
${language
    ? `Write the notes in ${language}, the language of the conversation.`
    : 'Write the notes in the same language as the transcript (the language most of it is spoken in).'} Only the content follows that language: keep the four section headings exactly as written above, in English (${NOTES_SECTIONS.map(h => `## ${h}`).join(', ')}).`
}

export interface MeetingNotesRequest {
  prompt: string // user message
  systemPrompt: string // replaces the preset's system prompt for this request
  context: string // transcript context, trimmed to fit
}

/**
 * Build the notes request from the transcript context (running summary + recent
 * verbatim, from useTranscriptContext). The context is already capped for chat
 * use; here it is also trimmed, from the start, so instructions + context +
 * request fit in promptBudget(contextLength).
 */
export function buildMeetingNotesRequest(
  context: string,
  contextLength: number,
  language: string | null = null,
  speakers: string[] = [],
  reasoning = false,
): MeetingNotesRequest {
  const systemPrompt = meetingNotesInstructions(speakers.length > 0 ? speakers : detectSpeakers(context), language)
  const available = promptBudget(contextLength, reasoning)
    - estimateTokens(systemPrompt) - estimateTokens(NOTES_REQUEST) - REQUEST_OVERHEAD_TOKENS
  const fitted = estimateTokens(context) > available ? transcriptTail(context, Math.max(0, available)) : context.trim()
  return { prompt: NOTES_REQUEST, systemPrompt, context: fitted }
}

// Models sometimes wrap the whole answer in a ```markdown fence; unwrap it.
export function normalizeNotesMarkdown(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  return (fenced ? fenced[1] : trimmed).trim()
}

// The .md file written by Save .md
export function notesDocument(markdown: string, meta: { date: Date; model: string; preset?: string }): string {
  const when = meta.date.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const details = [when, `Model: ${meta.model}`, meta.preset ? `Preset: ${meta.preset}` : ''].filter(Boolean).join(' · ')
  return `# Meeting notes\n\n_${details}_\n\n${normalizeNotesMarkdown(markdown)}\n`
}
