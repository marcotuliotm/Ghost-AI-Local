// The labeled transcript: segments, formatting and speaker names. Pure.

// A piece of transcript attributed to a speaker. speaker '' means unlabeled
// (diarization off) — rendered as a plain flowing paragraph.
export interface TranscriptSegment {
  speaker: string // 'You' | 'A' | 'B' | 'C' | 'Other' | ''
  text: string
}

// Display names the user gave to speaker labels ("A" → "Maria")
export type SpeakerNames = Record<string, string>

// The label as shown and as sent to the model: the custom name if there is one.
export function displaySpeaker(label: string, names: SpeakerNames = {}): string {
  return names[label]?.trim() || label
}

// Append a transcribed piece, merging consecutive pieces from the same speaker
// into one paragraph.
export function appendToSegments(segments: TranscriptSegment[], speaker: string, text: string): TranscriptSegment[] {
  const last = segments[segments.length - 1]
  if (last && last.speaker === speaker) {
    const updated = segments.slice()
    updated[updated.length - 1] = { ...last, text: `${last.text} ${text}`.trim() }
    return updated
  }
  return [...segments, { speaker, text }]
}

/**
 * Remove `text` from the end of the last segment if it belongs to `speaker`
 * (used to retract a mic segment that turned out to be echo of the speakers).
 * Returns the segments unchanged when it isn't there.
 */
export function removeTrailingText(segments: TranscriptSegment[], speaker: string, text: string): TranscriptSegment[] {
  const last = segments[segments.length - 1]
  if (!last || last.speaker !== speaker || !last.text.endsWith(text)) return segments
  const rest = last.text.slice(0, last.text.length - text.length).trim()
  return rest ? [...segments.slice(0, -1), { ...last, text: rest }] : segments.slice(0, -1)
}

// Relabel `from` as `to` (the same person), joining the paragraphs that become
// consecutive.
export function mergeSpeakers(segments: TranscriptSegment[], from: string, to: string): TranscriptSegment[] {
  if (from === to) return segments
  return segments.reduce<TranscriptSegment[]>(
    (out, s) => appendToSegments(out, s.speaker === from ? to : s.speaker, s.text),
    [],
  )
}

/**
 * The speaker a rename to `name` points at, when it is someone else: another
 * label with that display name (case-insensitive) or that label itself
 * ("B"). Never "You" (the mic channel) or unlabeled text.
 */
export function mergeTarget(segments: TranscriptSegment[], names: SpeakerNames, label: string, name: string): string | null {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return null
  const labels = [...new Set(segments.map(s => s.speaker))].filter(l => l && l !== label && l !== 'You')
  return labels.find(l => displaySpeaker(l, names).toLowerCase() === wanted || l.toLowerCase() === wanted) ?? null
}

// Format labeled segments into text for Ollama / save / context. Labels give
// the LLM useful turn-taking context ("You: ... / Maria: ...").
export function formatSegments(segments: TranscriptSegment[], names: SpeakerNames = {}): string {
  return segments
    .map(s => (s.speaker ? `${displaySpeaker(s.speaker, names)}: ${s.text}` : s.text))
    .join('\n')
    .trim()
}

// Distinct speakers in order of first appearance, as displayed (names applied)
export function transcriptSpeakers(segments: TranscriptSegment[], names: SpeakerNames = {}): string[] {
  const seen = new Set<string>()
  for (const s of segments) if (s.speaker) seen.add(displaySpeaker(s.speaker, names))
  return [...seen]
}
