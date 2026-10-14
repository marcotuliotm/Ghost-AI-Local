// Question detection for the "Questions" mode: answer as soon as the other side
// asks something, instead of waiting for the Auto timer. Pure heuristic —
// Whisper usually punctuates questions with "?", and an interrogative opening
// catches the ones it doesn't. English, Portuguese and Spanish.

// After a question fires, ignore new ones for this long (a single question is
// often split across two segments, and back-to-back questions would flood Ollama).
export const QUESTION_COOLDOWN_MS = 8000

// Opening words/phrases that make a sentence a question. Compared without
// accents and in lower case, against the start of the last sentence.
const INTERROGATIVE_OPENINGS = [
  // English
  'what', 'why', 'how', 'when', 'where', 'who', 'whom', 'whose', 'which',
  'can you', 'could you', 'would you', 'will you', 'do you', 'did you', 'have you',
  'are you', 'is it', 'is there', 'are there', 'should we', 'shall we', 'do we',
  // Portuguese
  'o que', 'por que', 'como', 'quando', 'onde', 'quem', 'qual', 'quais',
  'quanto', 'quantos', 'quantas', 'voce pode', 'voce poderia', 'voces podem', 'sera que',
  // Spanish ("porque"/"que" are left out: they open statements too)
  'cuando', 'donde', 'quien', 'cual', 'cuales', 'cuanto',
  'puedes', 'podrias', 'puede usted',
]

const MIN_WORDS = 3

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿¡]/g, '')
    .trim()
}

// The last sentence of a segment (a segment can hold several).
export function lastSentence(text: string): string {
  const parts = text.trim().split(/(?<=[.!?])\s+/)
  return parts[parts.length - 1] ?? ''
}

/**
 * True when the last sentence of `text` is a question: it ends with "?", or it
 * starts with an interrogative opening and has at least a few words. Statements
 * that merely contain "how" or "what" in the middle don't count.
 */
export function isQuestion(text: string): boolean {
  const sentence = lastSentence(text)
  if (!sentence) return false
  const words = sentence.split(/\s+/).filter(Boolean)
  if (sentence.endsWith('?')) return words.length >= 2
  if (words.length < MIN_WORDS || /[.!]$/.test(sentence)) return false
  const start = normalize(sentence)
  return INTERROGATIVE_OPENINGS.some(o => start === o || start.startsWith(`${o} `))
}
