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
