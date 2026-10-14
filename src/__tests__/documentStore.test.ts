import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DocumentStore } from '../../electron/documents'

let dir: string
let files: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-docs-'))
  files = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-files-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(files, { recursive: true, force: true })
})

const write = (name: string, content: string) => {
  const p = path.join(files, name)
  fs.writeFileSync(p, content)
  return p
}

// Fake local embedder: one dimension per topic word
const TOPICS = ['react', 'team', 'budget']
const embed = vi.fn(async (texts: string[]) =>
  texts.map(t => TOPICS.map(w => (t.toLowerCase().includes(w) ? 1 : 0.01))))

describe('DocumentStore', () => {
  it('should index text files and find the relevant excerpts by keyword', async () => {
    const store = new DocumentStore(dir)
    const cv = write('cv.md', '# CV\n\nFive years with React and TypeScript.\n\nLed a team of four.')
    const res = await store.add([cv], null, null)
    expect(res.errors).toEqual([])
    expect(res.added[0]).toEqual(expect.objectContaining({ name: 'cv.md', ext: 'md', enabled: true, embeddingModel: null }))

    const hits = await store.search('typescript experience', null, null)
    expect(hits[0]).toEqual(expect.objectContaining({ docName: 'cv.md' }))
    expect(hits[0].text).toContain('TypeScript')
  })

  it('should embed with a local model and match by meaning', async () => {
    const store = new DocumentStore(dir)
    await store.add([write('notes.txt', 'Our budget is ten thousand.\n\n' + 'filler '.repeat(200) + '\n\nThe React rewrite ships in May.')], embed, 'nomic-embed-text:latest')
    expect(store.list()[0].embeddingModel).toBe('nomic-embed-text:latest')
    const hits = await store.search('how much money do we have (budget)', embed, 'nomic-embed-text:latest', 1)
    expect(hits[0].text).toContain('budget')
  })

  it('should persist across restarts, and toggle/remove documents', async () => {
    const first = new DocumentStore(dir)
    await first.add([write('a.txt', 'alpha project plan'), write('b.txt', 'beta launch plan')], null, null)
    const second = new DocumentStore(dir)
    expect(second.list().map(d => d.name)).toEqual(['a.txt', 'b.txt'])

    const [a, b] = second.list()
    second.setEnabled(a.id, false)
    expect((await second.search('plan', null, null)).map(h => h.docName)).toEqual(['b.txt'])
    second.remove(b.id)
    expect(second.hasEnabled()).toBe(false)
    expect(await second.search('plan', null, null)).toEqual([])
    expect(new DocumentStore(dir).list().map(d => d.name)).toEqual(['a.txt'])
  })

  it('should report unsupported, empty and oversized files without stopping the rest', async () => {
    const store = new DocumentStore(dir)
    const big = path.join(files, 'big.txt')
    fs.writeFileSync(big, Buffer.alloc(16 * 1024 * 1024, 'a'))
    const res = await store.add([write('sheet.xlsx', 'x'), write('empty.md', '   \n\n'), big, write('ok.txt', 'fine')], null, null)
    expect(res.added.map(d => d.name)).toEqual(['ok.txt'])
    expect(res.errors.map(e => e.name)).toEqual(['sheet.xlsx', 'empty.md', 'big.txt'])
  })

  it('should fall back to keyword search when embedding fails, and reindex later', async () => {
    const store = new DocumentStore(dir)
    const failing = vi.fn().mockRejectedValue(new Error('model not found'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await store.add([write('team.md', 'Led a team of four engineers')], failing, 'nomic-embed-text')
    expect(store.list()[0].embeddingModel).toBeNull()

    expect(await store.reindex(embed, 'nomic-embed-text')).toBe(1)
    expect(store.list()[0].embeddingModel).toBe('nomic-embed-text')
    expect(await store.reindex(embed, 'nomic-embed-text')).toBe(0)
    warn.mockRestore()
  })

  it('should send small document sets in full, even without matching words', async () => {
    const store = new DocumentStore(dir)
    await store.add([write('cv.md', 'Seven years with React. Mentored four engineers.'), write('job.md', 'Senior frontend engineer to rebuild our portal.')], null, null)
    // A conversational question shares no keywords with either document
    expect(await store.search('why are you a good fit for this role?', null, null)).toEqual([])
    const all = await store.search('why are you a good fit for this role?', null, null, 6, 1536)
    expect(all.map(c => c.docName)).toEqual(['cv.md', 'job.md'])
  })

  it('should rank when the documents are larger than the budget', async () => {
    const store = new DocumentStore(dir)
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about logistics and shipping routes.`).join('\n\n')
    await store.add([write('ops.md', long + '\n\nOur budget for Q3 is fifty thousand.')], null, null)
    const hits = await store.search('what is the budget', null, null, 6, 50)
    expect(hits[0].text).toContain('budget')
  })
})
