import { describe, expect, it } from 'vitest'
import { HashingEmbedder } from '../src/llm/local.js'
import { chunkPages } from '../src/rag/chunker.js'
import { DocumentError, DocumentService } from '../src/rag/documents.js'
import { InMemoryVectorStore } from '../src/rag/vectorStore.js'
import { makePdf, SAMPLE_PAGES } from './helpers.js'

describe('chunkPages', () => {
  it('keeps each chunk on one page and records the page number', () => {
    const chunks = chunkPages(['alpha beta gamma', 'delta epsilon'])
    expect(chunks.map((c) => c.page)).toEqual([1, 2])
    expect(chunks.map((c) => c.index)).toEqual([0, 1])
  })

  it('overlaps consecutive chunks and breaks at sentence boundaries', () => {
    const sentence = 'This sentence is about forty characters. '
    const chunks = chunkPages([sentence.repeat(20)], { size: 200, overlap: 50 })
    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith('.')).toBe(true)
      expect(chunk.text.length).toBeLessThanOrEqual(200)
    }
    // The start of each chunk repeats text from the end of the previous one.
    const tail = chunks[0]!.text.slice(-30)
    expect(chunks[1]!.text).toContain(tail.trim().split(' ').at(-1))
  })

  it('rejects overlap >= size', () => {
    expect(() => chunkPages(['x'], { size: 10, overlap: 10 })).toThrow()
  })
})

describe('InMemoryVectorStore', () => {
  it('ranks by cosine similarity within a single document', () => {
    const store = new InMemoryVectorStore()
    const chunk = (index: number) => ({ index, page: 1, text: `c${index}` })
    store.add('doc-a', [chunk(0), chunk(1)], [[1, 0], [0, 1]])
    store.add('doc-b', [chunk(0)], [[1, 0]])

    const hits = store.search('doc-a', [0.1, 0.9], 2)
    expect(hits.map((h) => h.index)).toEqual([1, 0])
    expect(hits.every((h) => h.documentId === 'doc-a')).toBe(true)
    expect(store.search('missing', [1, 0])).toEqual([])
  })
})

describe('DocumentService', () => {
  it('indexes a PDF once and answers queries from the right page', async () => {
    const service = new DocumentService(new HashingEmbedder())
    const info = await service.ingestPdf('lean.pdf', await makePdf(SAMPLE_PAGES))

    expect(info).toMatchObject({ name: 'lean.pdf', pages: 3 })
    const [top] = await service.search(info.id, 'minimum viable product assumptions')
    expect(top?.page).toBe(1)
    const [second] = await service.search(info.id, 'talking to customers before building')
    expect(second?.page).toBe(2)
  })

  it('keeps documents separate', async () => {
    const service = new DocumentService(new HashingEmbedder())
    const a = await service.ingestPdf('a.pdf', await makePdf([['apples and oranges']]))
    const b = await service.ingestPdf('b.pdf', await makePdf([['rockets and satellites']]))

    const [hit] = await service.search(b.id, 'apples')
    expect(hit?.text).toContain('rockets')
    expect(service.list().map((d) => d.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('rejects files that are not PDFs and strips path parts from names', async () => {
    const service = new DocumentService(new HashingEmbedder())
    await expect(service.ingestPdf('x.pdf', new TextEncoder().encode('not a pdf'))).rejects.toBeInstanceOf(
      DocumentError,
    )
    const info = await service.ingestPdf('../../etc/passwd.pdf', await makePdf([['hello world']]))
    expect(info.name).toBe('passwd.pdf')
  })
})
