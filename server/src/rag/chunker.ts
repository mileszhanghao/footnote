export interface Chunk {
  /** Position of the chunk within its document, starting at 0. */
  index: number
  /** 1-based PDF page the chunk came from, so answers can cite it. */
  page: number
  text: string
}

export interface ChunkOptions {
  size: number
  overlap: number
}

const DEFAULTS: ChunkOptions = { size: 900, overlap: 150 }

/**
 * Splits each page into overlapping windows, preferring to break at a
 * paragraph or sentence boundary near the window end. Chunks never span two
 * pages, so every chunk has exactly one page number to cite.
 *
 * The course version used 500-character chunks with zero overlap, which cuts
 * sentences in half and loses context at every boundary.
 */
export function chunkPages(pages: string[], options: Partial<ChunkOptions> = {}): Chunk[] {
  const { size, overlap } = { ...DEFAULTS, ...options }
  if (overlap >= size) throw new Error('overlap must be smaller than size')

  const chunks: Chunk[] = []
  pages.forEach((raw, pageIndex) => {
    const text = normalize(raw)
    let start = 0
    while (start < text.length) {
      let end = Math.min(start + size, text.length)
      if (end < text.length) end = findBreak(text, start, end)
      const piece = text.slice(start, end).trim()
      if (piece) chunks.push({ index: chunks.length, page: pageIndex + 1, text: piece })
      if (end >= text.length) break
      start = Math.max(end - overlap, start + 1)
    }
  })
  return chunks
}

function normalize(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*\n\s*/g, '\n\n')
    .replace(/(?<!\n)\n(?!\n)/g, ' ')
    .trim()
}

/** Latest paragraph break, else sentence end, else space in the last 30% of the window. */
function findBreak(text: string, start: number, end: number): number {
  const minEnd = start + Math.floor((end - start) * 0.7)
  const window = text.slice(minEnd, end)
  for (const pattern of [/\n\n/g, /[.!?]\s/g, /\s/g]) {
    let last = -1
    for (const match of window.matchAll(pattern)) last = match.index + match[0].length
    if (last > 0) return minEnd + last
  }
  return end
}
