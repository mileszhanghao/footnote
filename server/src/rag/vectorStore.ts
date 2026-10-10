import type { Chunk } from './chunker.js'

export interface ScoredChunk extends Chunk {
  documentId: string
  score: number
}

interface Entry {
  chunk: Chunk
  vector: Float32Array
}

/**
 * In-memory vector index, partitioned by document. Vectors are L2-normalized
 * on insert so cosine similarity is a plain dot product.
 *
 * Good for a single-node app; swapping in pgvector or another store only
 * means implementing add/search/remove.
 */
export class InMemoryVectorStore {
  private readonly byDocument = new Map<string, Entry[]>()

  add(documentId: string, chunks: Chunk[], vectors: number[][]): void {
    if (chunks.length !== vectors.length) throw new Error('chunks and vectors must have the same length')
    const entries = chunks.map((chunk, i) => ({ chunk, vector: normalize(vectors[i]!) }))
    this.byDocument.set(documentId, entries)
  }

  search(documentId: string, query: number[], k = 4): ScoredChunk[] {
    const entries = this.byDocument.get(documentId)
    if (!entries) return []
    const q = normalize(query)
    return entries
      .map(({ chunk, vector }) => ({ ...chunk, documentId, score: dot(q, vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }

  remove(documentId: string): void {
    this.byDocument.delete(documentId)
  }

  has(documentId: string): boolean {
    return this.byDocument.has(documentId)
  }
}

function normalize(v: number[] | Float32Array): Float32Array {
  const out = Float32Array.from(v)
  let norm = 0
  for (const x of out) norm += x * x
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i]! /= norm
  return out
}

function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`vector dimension mismatch: ${a.length} vs ${b.length}`)
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}
