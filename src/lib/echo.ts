// Echo detection for "Both" mode without headphones: the mic also picks up the
// call coming out of the speakers, so the same words get transcribed twice —
// once on the system channel (right speaker) and once on the mic ("You").
// Pure module.

// Mic and system segments of the same speech close within a few seconds.
export const ECHO_WINDOW_MS = 8000
// Share of the shorter text's words found in the other one.
export const ECHO_SIMILARITY = 0.6
// Below this many words a match is too likely to be chance ("yes", "okay").
const MIN_WORDS = 3

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents: Whisper spells them inconsistently
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Overlap coefficient of the two word sets: |A ∩ B| / min(|A|, |B|). An echo
 * is often only part of the original (the mic picks it up late or quietly),
 * so containment matters more than equal length.
 */
export function textSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeWords(a))
  const wb = new Set(normalizeWords(b))
  if (wa.size === 0 || wb.size === 0) return 0
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  return shared / Math.min(wa.size, wb.size)
}

export function isEcho(micText: string, systemText: string): boolean {
  const micWords = normalizeWords(micText).length
  const systemWords = normalizeWords(systemText).length
  if (Math.min(micWords, systemWords) < MIN_WORDS) return false
  return textSimilarity(micText, systemText) >= ECHO_SIMILARITY
}

type Channel = 'mic' | 'system'

/**
 * Remembers recent transcriptions per channel (by when their audio ended) so a
 * new one can be checked against the other channel's recent ones.
 */
export class EchoFilter {
  private recent: { channel: Channel; text: string; at: number }[] = []

  constructor(private windowMs = ECHO_WINDOW_MS) {}

  private prune(now: number) {
    this.recent = this.recent.filter(r => now - r.at <= this.windowMs)
  }

  // The recent text on `channel` that `text` duplicates, if any.
  match(channel: Channel, text: string, at: number): string | null {
    this.prune(at)
    const hit = this.recent.find(r => r.channel === channel && Math.abs(at - r.at) <= this.windowMs && isEcho(
      channel === 'mic' ? r.text : text,
      channel === 'mic' ? text : r.text,
    ))
    return hit ? hit.text : null
  }

  record(channel: Channel, text: string, at: number) {
    this.prune(at)
    this.recent.push({ channel, text, at })
  }

  forget(channel: Channel, text: string) {
    this.recent = this.recent.filter(r => !(r.channel === channel && r.text === text))
  }

  reset() {
    this.recent = []
  }
}
