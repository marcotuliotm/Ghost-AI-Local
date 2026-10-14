import { describe, it, expect } from 'vitest'
import {
  bm25Scores, chunkText, cosine, documentsSystemMessage, embeddingPrefix, findModel, fitChunks, isSupportedFile,
  normalizeVector, rankChunks, tokenize, uniqueSources, type IndexedChunk,
} from '../lib/rag'

describe('chunkText', () => {
  it('should keep paragraphs together and pack short ones', () => {
    const chunks = chunkText('First paragraph.\n\nSecond one.\n\n\nThird.', 40)
    expect(chunks).toEqual(['First paragraph. Second one. Third.'])
  })

  it('should split long paragraphs by sentence, and long sentences by length', () => {
    const para = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const chunks = chunkText(para, 120)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every(c => c.length <= 120)).toBe(true)
    expect(chunkText('x'.repeat(250), 100)).toEqual(['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)])
  })

  it('should normalize whitespace and drop empty text', () => {
    expect(chunkText('  a\r\n  b  \n\n   \n\n')).toEqual(['a b'])
    expect(chunkText('   ')).toEqual([])
  })
})

describe('keyword ranking', () => {
  it('should drop stopwords and accents', () => {
    expect(tokenize('The candidate has experiência em Python e React')).toEqual(['candidate', 'experiencia', 'python', 'react'])
  })

  it('should match plurals', () => {
    expect(tokenize('public holidays, two laptops, projetos')).toEqual(['public', 'holiday', 'two', 'laptop', 'projeto'])
    expect(tokenize('business class')).toEqual(['business', 'class'])
  })

  it('should score matching documents higher, rare terms most', () => {
    const docs = [tokenize('Python and React developer'), tokenize('Project manager, budget planning'), tokenize('Python Python data pipelines')]
    const scores = bm25Scores(tokenize('python pipelines'), docs)
    expect(scores[1]).toBe(0)
    expect(scores[2]).toBeGreaterThan(scores[0])
  })
})

const chunk = (docName: string, text: string, embedding?: number[]): IndexedChunk =>
  ({ docName, text, tokens: tokenize(text), embedding: embedding && normalizeVector(embedding) })

describe('rankChunks', () => {
  const chunks = [
    chunk('cv.pdf', 'Five years building React and TypeScript apps', [1, 0, 0]),
    chunk('cv.pdf', 'Led a team of four engineers', [0, 1, 0]),
    chunk('job.md', 'We need someone to own our TypeScript frontend', [0.9, 0.1, 0]),
    chunk('agenda.md', 'Lunch at noon', [0, 0, 1]),
  ]

  it('should rank by keywords without embeddings', () => {
    const top = rankChunks('typescript experience', chunks.map(c => ({ ...c, embedding: undefined })), null)
    expect(top.map(c => c.docName).sort()).toEqual(['cv.pdf', 'job.md'])
    expect(top.every(c => c.score > 0)).toBe(true)
  })

  it('should find matches by meaning when embeddings are available', () => {
    // "people management" shares no words with "Led a team of four engineers"
    const top = rankChunks('people management', chunks, normalizeVector([0, 1, 0]))
    expect(top[0].text).toBe('Led a team of four engineers')
    expect(top.some(c => c.text === 'Lunch at noon')).toBe(false)
  })

  it('should cap the number of results', () => {
    expect(rankChunks('typescript', chunks, null, 1)).toHaveLength(1)
    expect(rankChunks('zzz unrelated', chunks, null)).toEqual([])
  })
})

describe('prompt helpers', () => {
  it('should fit chunks best-first in the token budget', () => {
    const chunks = [
      { docName: 'a', text: 'x'.repeat(400), score: 3 },
      { docName: 'b', text: 'y'.repeat(4000), score: 2 },
      { docName: 'c', text: 'z'.repeat(400), score: 1 },
    ]
    expect(fitChunks(chunks, 300).map(c => c.docName)).toEqual(['a', 'c'])
  })

  it('should label excerpts with their document', () => {
    const msg = documentsSystemMessage([{ docName: 'cv.pdf', text: 'React dev', score: 1 }])
    expect(msg).toContain('[cv.pdf]\nReact dev')
    expect(msg).toContain('do not invent')
    expect(uniqueSources([{ docName: 'a', text: '', score: 1 }, { docName: 'a', text: '', score: 1 }, { docName: 'b', text: '', score: 1 }])).toEqual(['a', 'b'])
  })

  it('should recognize supported files and tagged model names', () => {
    expect(isSupportedFile('CV.PDF')).toBe(true)
    expect(isSupportedFile('notes.md')).toBe(true)
    expect(isSupportedFile('sheet.xlsx')).toBe(false)
    expect(findModel([{ name: 'nomic-embed-text:latest' }], 'nomic-embed-text')?.name).toBe('nomic-embed-text:latest')
    expect(findModel([{ name: 'other:latest' }], 'nomic-embed-text')).toBeUndefined()
    expect(cosine(normalizeVector([1, 1]), normalizeVector([1, 1]))).toBeCloseTo(1)
  })
})

describe('section-aware chunking', () => {
  const handbook = '# Handbook\n\n## Annual leave\n\nTwenty-five days per year.\n\n## Travel\n\nBook flights early.\n\nEconomy by default.'

  it('should never mix two sections and should label excerpts with their section', () => {
    expect(chunkText(handbook)).toEqual([
      'Annual leave: Twenty-five days per year.',
      'Travel: Book flights early. Economy by default.',
    ])
  })

  it('should split a long section without losing its title', () => {
    const long = '## Security\n\n' + Array.from({ length: 20 }, (_, i) => `Rule ${i} applies to everyone.`).join(' ')
    const chunks = chunkText(long, 120)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every(c => c.startsWith('Security: ') && c.length <= 120)).toBe(true)
  })
})

describe('embedding prefixes', () => {
  it('should use the task prefixes the model was trained with', () => {
    expect(embeddingPrefix('nomic-embed-text:latest', 'query')).toBe('search_query: ')
    expect(embeddingPrefix('nomic-embed-text', 'document')).toBe('search_document: ')
    expect(embeddingPrefix('mxbai-embed-large', 'query')).toContain('Represent this sentence')
    expect(embeddingPrefix('mxbai-embed-large', 'document')).toBe('')
    expect(embeddingPrefix('all-minilm', 'query')).toBe('')
  })
})

describe('result diversity', () => {
  it('should skip near-duplicates of a better-ranked excerpt', () => {
    const chunks = [
      chunk('a.md', 'Travel: Book flights through the travel tool fourteen days ahead.'),
      chunk('a.md', 'Appendix: Reminder: Book flights through the travel tool fourteen days ahead.'),
      chunk('a.md', 'Hotels near the client office; flights in economy.'),
    ]
    const top = rankChunks('book flights', chunks, null)
    expect(top).toHaveLength(2)
    expect(top.map(c => c.text)).not.toContain(chunks[1].text)
  })
})
