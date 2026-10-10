// @vitest-environment node
/// <reference types="node" />
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { SAMPLE_FILE, createDemoApi } from './demoApi'

const fromPublic = async (url: string) =>
  new Uint8Array(await readFile(new URL(`../../public/${url.split('/').pop()}`, import.meta.url)))

describe('demo API (RAG pipeline in the browser)', () => {
  const api = createDemoApi(fromPublic)

  it('indexes the bundled sample PDF on first load', async () => {
    const [doc] = await api.documents()
    expect(doc).toMatchObject({ name: SAMPLE_FILE, pages: 3 })
    expect(doc!.chunks).toBeGreaterThan(0)
  })

  it('answers from the document with page citations', async () => {
    const [doc] = await api.documents()
    const result = await api.ask(doc!.id, 'How much does delivery cost?')
    expect(result.answer).toContain('$3.99')
    expect(result.answer).toContain('(p. 2)')
    expect(result.citations.some((c) => c.type === 'document' && c.page === 2)).toBe(true)
    expect(result.steps.map((s) => s.tool)).toEqual(['search_document'])
  })

  it('rejects files that are not PDFs', async () => {
    const notPdf = new File(['hello'], 'notes.pdf', { type: 'application/pdf' })
    await expect(api.upload(notPdf)).rejects.toThrow('Could not read this file as a PDF')
  })
})
