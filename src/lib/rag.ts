// Local retrieval over the user's own documents (CV, job description, agenda,
// slides...). Pure module shared by the main process (which stores the index
// and runs the search) and the renderer (prompt formatting).
//
// Ranking is hybrid: BM25 keyword scoring always works; when a local embedding
// model is installed in Ollama (e.g. nomic-embed-text) cosine similarity of
// embeddings is blended in. Nothing here touches the network.

import { normalizeWords, textSimilarity } from './echo'
import { estimateTokens } from './context'

export const SUPPORTED_EXTENSIONS = ['txt', 'md', 'markdown', 'pdf'] as const
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024
export const MAX_CHUNKS_PER_DOCUMENT = 2000
// ~150 tokens: one topic per excerpt (sharper embeddings), still a full thought
export const CHUNK_CHARS = 600
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text'
// Share of the prompt budget document excerpts may take
export const DOCUMENTS_SHARE = 0.25
export const TOP_K = 6

export interface DocumentInfo {
  id: string
  name: string
  ext: string
  size: number
  addedAt: number
  enabled: boolean
  chunkCount: number
  // Embedded with this model (null: keyword search only)
  embeddingModel: string | null
}

export interface RetrievedChunk {
  docName: string
  text: string
  score: number
}

// Markdown heading line ("# Title" ... "###### Title")
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/

/**
 * Split text into ~CHUNK_CHARS excerpts. Markdown headings are hard
 * boundaries — an excerpt never mixes two sections, so its embedding stays on
 * one topic — and each excerpt starts with its section title for context.
 * Within a section, paragraphs are packed together; a paragraph longer than
 * the limit is split by sentences, and a sentence by characters. Text without
 * headings (PDFs, plain notes) is chunked by paragraphs the same way.
 */
export function chunkText(text: string, maxChars = CHUNK_CHARS): string[] {
  const sections: { title: string; paragraphs: string[] }[] = [{ title: '', paragraphs: [] }]
  let buffer: string[] = []
  const flushParagraph = () => {
    const p = buffer.join(' ').replace(/\s+/g, ' ').trim()
    if (p) sections[sections.length - 1].paragraphs.push(p)
    buffer = []
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(HEADING)
    if (heading) {
      flushParagraph()
      sections.push({ title: heading[1].trim(), paragraphs: [] })
    } else if (!line.trim()) {
      flushParagraph()
    } else {
      buffer.push(line)
    }
  }
  flushParagraph()

  const chunks: string[] = []
  for (const { title, paragraphs } of sections) {
    if (paragraphs.length === 0) continue
    const prefix = title ? `${title}: ` : ''
    const room = Math.max(50, maxChars - prefix.length)
    const pieces: string[] = []
    for (const p of paragraphs) {
      if (p.length <= room) { pieces.push(p); continue }
      for (const sentence of p.split(/(?<=[.!?])\s+/)) {
        if (sentence.length <= room) pieces.push(sentence)
        else for (let i = 0; i < sentence.length; i += room) pieces.push(sentence.slice(i, i + room))
      }
    }
    let current = ''
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > room) {
        chunks.push(prefix + current)
        current = piece
      } else {
        current = current ? `${current} ${piece}` : piece
      }
    }
    if (current) chunks.push(prefix + current)
  }
  return chunks
}

/**
 * Task prefixes some embedding models are trained with (nomic-embed-text:
 * "search_query:" / "search_document:"; mxbai-embed-large: an instruction on
 * queries only). Without them, retrieval quality drops noticeably.
 */
export function embeddingPrefix(model: string, kind: 'query' | 'document'): string {
  const name = model.toLowerCase()
  if (name.startsWith('nomic-embed')) return kind === 'query' ? 'search_query: ' : 'search_document: '
  if (name.startsWith('mxbai-embed')) return kind === 'query' ? 'Represent this sentence for searching relevant passages: ' : ''
  return ''
}

// Function words that carry no meaning for retrieval (EN / PT / ES)
const STOPWORDS = new Set(`
a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its
me my no not of on or our she so than that the their them then there these they this to too us was we were what when
where which who why will with would you your
o os as um uma uns umas de do da dos das em no na nos nas por para com sem que e ou se mas como mais muito ja nao sim
eu tu ele ela nos vos eles elas meu minha seu sua isso isto aquilo esse essa este esta ao aos foi ser ter tem sao esta
el la los las un una unos unas del al y o pero con sin por para es son fue lo le les su sus mi mis tu tus yo
`.split(/\s+/).filter(Boolean))

// Light stemming: drop a plural "s" (holidays → holiday, laptops → laptop,
// projetos → projeto), which covers most inflection in EN/PT/ES queries.
function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

export function tokenize(text: string): string[] {
  return normalizeWords(text).filter(w => w.length > 1 && !STOPWORDS.has(w)).map(stem)
}

/** BM25 scores of `query` against each document in `docs` (token lists). */
export function bm25Scores(query: string[], docs: string[][], k1 = 1.2, b = 0.75): number[] {
  const n = docs.length
  if (n === 0 || query.length === 0) return docs.map(() => 0)
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / n || 1
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const terms = [...new Set(query)]
  return docs.map(d => {
    if (d.length === 0) return 0
    const tf = new Map<string, number>()
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const t of terms) {
      const f = tf.get(t)
      if (!f) continue
      const nt = df.get(t) ?? 0
      const idf = Math.log(1 + (n - nt + 0.5) / (nt + 0.5))
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avgLen))
    }
    return score
  })
}

export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map(x => x / norm)
}

// Cosine similarity of two L2-normalized vectors
export function cosine(a: number[], b: number[]): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

export interface IndexedChunk {
  docName: string
  text: string
  tokens: string[]
  embedding?: number[]
}

// Below these a chunk isn't considered relevant at all
const MIN_COSINE = 0.35
const SEMANTIC_WEIGHT = 0.7
// Excerpts this similar to one already chosen add nothing (repeated headers,
// a section pasted twice) and would crowd out other relevant text
const DUPLICATE_SIMILARITY = 0.85

/**
 * Rank chunks for `query`. BM25 is normalized by the best score so it lands in
 * 0-1; when the query and a chunk both have embeddings, the score blends in
 * cosine similarity. Chunks matching neither way are left out, and so are
 * near-duplicates of a better-ranked chunk.
 */
export function rankChunks(query: string, chunks: IndexedChunk[], queryEmbedding: number[] | null, k = TOP_K): RetrievedChunk[] {
  const lexical = bm25Scores(tokenize(query), chunks.map(c => c.tokens))
  const maxLexical = Math.max(0, ...lexical)
  const scored = chunks.map((c, i) => {
    const lex = maxLexical > 0 ? lexical[i] / maxLexical : 0
    const sem = queryEmbedding && c.embedding ? cosine(queryEmbedding, c.embedding) : null
    const relevant = lexical[i] > 0 || (sem !== null && sem >= MIN_COSINE)
    const score = sem === null ? lex : SEMANTIC_WEIGHT * Math.max(0, sem) + (1 - SEMANTIC_WEIGHT) * lex
    return { docName: c.docName, text: c.text, score: relevant ? score : 0 }
  })
  const picked: RetrievedChunk[] = []
  for (const c of scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score)) {
    if (picked.length >= k) break
    if (picked.some(p => textSimilarity(p.text, c.text) >= DUPLICATE_SIMILARITY)) continue
    picked.push(c)
  }
  return picked
}

// Prompt cost of one excerpt (text + its [document] label)
export function chunkTokens(c: { docName: string; text: string }): number {
  return estimateTokens(c.text) + estimateTokens(c.docName) + 4
}

// Best-first chunks that fit `maxTokens` (a chunk that doesn't fit is skipped)
export function fitChunks(chunks: RetrievedChunk[], maxTokens: number): RetrievedChunk[] {
  const out: RetrievedChunk[] = []
  let used = 0
  for (const c of chunks) {
    const cost = chunkTokens(c)
    if (used + cost > maxTokens) continue
    out.push(c)
    used += cost
  }
  return out
}

export function documentsSystemMessage(chunks: RetrievedChunk[]): string {
  const body = chunks.map(c => `[${c.docName}]\n${c.text}`).join('\n\n')
  return `Excerpts from the user's own documents (e.g. CV, job description, agenda, notes), retrieved for this request. Use them when relevant and say which document you relied on; do not invent details they don't contain:\n\n${body}`
}

export function uniqueSources(chunks: RetrievedChunk[]): string[] {
  return [...new Set(chunks.map(c => c.docName))]
}

export function fileExtension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

export function isSupportedFile(name: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(fileExtension(name))
}

// Ollama names models "name:tag"; a setting without a tag means ":latest"
export function findModel<T extends { name: string }>(models: T[], wanted: string): T | undefined {
  return models.find(m => m.name === wanted || m.name === `${wanted}:latest`)
}
