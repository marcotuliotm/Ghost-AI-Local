import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  chunkText,
  fileExtension,
  isSupportedFile,
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_DOCUMENT_BYTES,
  normalizeVector,
  rankChunks,
  chunkTokens,
  tokenize,
  TOP_K,
  type DocumentInfo,
  type IndexedChunk,
  type RetrievedChunk,
} from '../src/lib/rag'

// Turns texts into vectors with a local Ollama embedding model (`kind` picks
// the model's query/document task prefix), or null when no embedding model is
// available (keyword search only).
export type Embedder = ((texts: string[], kind: 'query' | 'document') => Promise<number[][]>) | null

interface StoredChunk {
  text: string
  embedding?: number[]
}

interface StoredDocument extends Omit<DocumentInfo, 'chunkCount'> {
  chunks: StoredChunk[]
}

const EMBED_BATCH = 16

async function extractText(filePath: string, ext: string): Promise<string> {
  const data = await fs.promises.readFile(filePath)
  if (ext === 'pdf') {
    // pdf.js build without workers or network access; externalized in Vite
    const { extractText: extractPdf, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(data))
    const { text } = await extractPdf(pdf, { mergePages: false })
    return (Array.isArray(text) ? text : [text]).join('\n\n')
  }
  return data.toString('utf-8')
}

/**
 * The user's documents for retrieval, kept in userData/documents/index.json
 * (text chunks + optional embeddings). Everything stays on this machine.
 */
export class DocumentStore {
  private docs: StoredDocument[] = []
  private loaded = false
  // Tokens are derived data: computed on demand, not stored
  private tokenCache = new Map<string, string[][]>()

  constructor(private dir: string) {}

  private get indexPath() {
    return path.join(this.dir, 'index.json')
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'))
      if (Array.isArray(raw?.docs)) this.docs = raw.docs
    } catch {
      this.docs = []
    }
  }

  private save() {
    fs.mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.indexPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, docs: this.docs }))
    fs.renameSync(tmp, this.indexPath) // atomic: a crash never leaves a half-written index
  }

  private info(d: StoredDocument): DocumentInfo {
    const { chunks, ...rest } = d
    return { ...rest, chunkCount: chunks.length }
  }

  list(): DocumentInfo[] {
    this.load()
    return this.docs.map(d => this.info(d))
  }

  private async embedChunks(chunks: StoredChunk[], embed: NonNullable<Embedder>) {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)
      const vectors = await embed(batch.map(c => c.text), 'document')
      batch.forEach((c, j) => { c.embedding = vectors[j] ? normalizeVector(vectors[j]) : undefined })
    }
  }

  /** Read, chunk (and embed, when possible) the given files. */
  async add(filePaths: string[], embed: Embedder, embeddingModel: string | null) {
    this.load()
    const added: DocumentInfo[] = []
    const errors: { name: string; error: string }[] = []
    for (const filePath of filePaths) {
      const name = path.basename(filePath)
      try {
        if (!isSupportedFile(name)) throw new Error('Unsupported file type (use .txt, .md or .pdf)')
        const { size } = await fs.promises.stat(filePath)
        if (size > MAX_DOCUMENT_BYTES) throw new Error('File is larger than 15 MB')
        const ext = fileExtension(name)
        const text = await extractText(filePath, ext)
        const chunks: StoredChunk[] = chunkText(text).slice(0, MAX_CHUNKS_PER_DOCUMENT).map(t => ({ text: t }))
        if (chunks.length === 0) throw new Error('No text found (scanned PDFs need OCR first)')
        let model: string | null = null
        if (embed) {
          try {
            await this.embedChunks(chunks, embed)
            model = embeddingModel
          } catch (err) {
            console.warn('[documents] Embedding failed, keyword search only:', err)
            chunks.forEach(c => { delete c.embedding })
          }
        }
        const doc: StoredDocument = {
          id: randomUUID(), name, ext, size, addedAt: Date.now(), enabled: true, embeddingModel: model, chunks,
        }
        this.docs.push(doc)
        added.push(this.info(doc))
      } catch (err: any) {
        errors.push({ name, error: err?.message || String(err) })
      }
    }
    if (added.length > 0) this.save()
    return { added, errors }
  }

  remove(id: string) {
    this.load()
    this.docs = this.docs.filter(d => d.id !== id)
    this.tokenCache.delete(id)
    this.save()
  }

  setEnabled(id: string, enabled: boolean) {
    this.load()
    const doc = this.docs.find(d => d.id === id)
    if (!doc) return
    doc.enabled = enabled
    this.save()
  }

  /** Embed documents that aren't embedded with `embeddingModel` yet. */
  async reindex(embed: NonNullable<Embedder>, embeddingModel: string) {
    this.load()
    let count = 0
    for (const doc of this.docs) {
      if (doc.embeddingModel === embeddingModel) continue
      await this.embedChunks(doc.chunks, embed)
      doc.embeddingModel = embeddingModel
      count++
    }
    if (count > 0) this.save()
    return count
  }

  private tokens(doc: StoredDocument): string[][] {
    let t = this.tokenCache.get(doc.id)
    if (!t) {
      t = doc.chunks.map(c => tokenize(c.text))
      this.tokenCache.set(doc.id, t)
    }
    return t
  }

  hasEnabled(): boolean {
    this.load()
    return this.docs.some(d => d.enabled)
  }

  /**
   * Chunks of the enabled documents for `query`. When all of them fit in
   * `maxTokens` (a CV plus a job description, typically) they are returned in
   * full, in document order — ranking would only risk dropping what a
   * conversational question shares no words with. Otherwise the top `k` are
   * ranked; embeddings are used only for documents embedded with the same
   * model as the query.
   */
  async search(query: string, embed: Embedder, embeddingModel: string | null, k = TOP_K, maxTokens = 0): Promise<RetrievedChunk[]> {
    this.load()
    const enabled = this.docs.filter(d => d.enabled)
    if (enabled.length === 0) return []
    const all = enabled.flatMap(d => d.chunks.map(c => ({ docName: d.name, text: c.text, score: 1 })))
    if (maxTokens > 0 && all.reduce((n, c) => n + chunkTokens(c), 0) <= maxTokens) return all
    if (!query.trim()) return []
    let queryEmbedding: number[] | null = null
    if (embed && embeddingModel && enabled.some(d => d.embeddingModel === embeddingModel)) {
      try {
        queryEmbedding = normalizeVector((await embed([query], 'query'))[0])
      } catch (err) {
        console.warn('[documents] Query embedding failed, keyword search only:', err)
      }
    }
    const indexed: IndexedChunk[] = enabled.flatMap(d => {
      const tokens = this.tokens(d)
      const sameModel = d.embeddingModel === embeddingModel
      return d.chunks.map((c, i) => ({
        docName: d.name,
        text: c.text,
        tokens: tokens[i],
        embedding: sameModel ? c.embedding : undefined,
      }))
    })
    return rankChunks(query, indexed, queryEmbedding, k)
  }
}
