import { randomUUID } from 'node:crypto'
import { extractText } from 'unpdf'
import type { Embedder } from '../llm/types.js'
import { chunkPages } from './chunker.js'
import { InMemoryVectorStore, type ScoredChunk } from './vectorStore.js'

export interface DocumentInfo {
  id: string
  name: string
  pages: number
  chunks: number
  uploadedAt: string
}

export class DocumentError extends Error {}

/**
 * Owns uploaded documents. A PDF is parsed, chunked and embedded exactly once,
 * at upload time; questions only embed the query. The course version re-read,
 * re-chunked and re-embedded the whole PDF on every single question.
 */
export class DocumentService {
  private readonly docs = new Map<string, DocumentInfo>()

  constructor(
    private readonly embedder: Embedder,
    private readonly store = new InMemoryVectorStore(),
  ) {}

  async ingestPdf(name: string, bytes: Uint8Array): Promise<DocumentInfo> {
    let pages: string[]
    try {
      ;({ text: pages } = await extractText(bytes, { mergePages: false }))
    } catch {
      throw new DocumentError('Could not read this file as a PDF')
    }
    const chunks = chunkPages(pages)
    if (chunks.length === 0) {
      throw new DocumentError('No text found in this PDF (scanned PDFs need OCR first)')
    }
    const vectors = await this.embedder.embed(chunks.map((c) => c.text))

    const info: DocumentInfo = {
      id: randomUUID(),
      name: sanitizeName(name),
      pages: pages.length,
      chunks: chunks.length,
      uploadedAt: new Date().toISOString(),
    }
    this.store.add(info.id, chunks, vectors)
    this.docs.set(info.id, info)
    return info
  }

  list(): DocumentInfo[] {
    return [...this.docs.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  }

  get(id: string): DocumentInfo | undefined {
    return this.docs.get(id)
  }

  async search(documentId: string, query: string, k = 4): Promise<ScoredChunk[]> {
    if (!this.docs.has(documentId)) throw new DocumentError(`Unknown document ${documentId}`)
    const [vector] = await this.embedder.embed([query])
    return this.store.search(documentId, vector!, k)
  }

  remove(id: string): boolean {
    this.store.remove(id)
    return this.docs.delete(id)
  }
}

/** Display name only; files are never written to disk under the user's name. */
function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'document.pdf'
  return base.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'document.pdf'
}
