import type { ChatModel, Embedder, Message, ModelTurn, ToolSpec } from './types.js'

/**
 * Offline embedder: hashes word unigrams and bigrams into a fixed-size vector
 * (the "hashing trick"). No API key, fully deterministic — used for tests and
 * when OPENAI_API_KEY is not set. Retrieval quality is lexical, not semantic.
 */
export class HashingEmbedder implements Embedder {
  readonly name = 'local:hashing'
  private readonly dimensions: number

  constructor(dimensions = 1024) {
    this.dimensions = dimensions
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text))
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0)
    const words = tokenize(text)
    const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)]
    for (const feature of features) {
      const hash = fnv1a(feature)
      const bucket = hash % this.dimensions
      // A second, independent bit picks the sign so collisions tend to cancel out.
      const sign = fnv1a(feature, 0x9747b28c) & 1 ? 1 : -1
      vector[bucket]! += sign
    }
    return vector
  }
}

const STOPWORDS = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was were what when where which who why will with how does do did'.split(
    ' ',
  ),
)

/** 32-bit FNV-1a. Pure JS so the same embedder runs in Node and in the browser demo. */
function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

/**
 * Offline stand-in for an LLM. It follows the same tool protocol as the real
 * model — first it calls search_document, then it answers — but the "answer"
 * is the retrieved passages themselves, labeled as such. This keeps the whole
 * pipeline runnable and testable without an API key.
 */
export class ExtractiveChatModel implements ChatModel {
  readonly name = 'local:extractive'

  async next(messages: Message[], tools: ToolSpec[]): Promise<ModelTurn> {
    const last = messages.at(-1)
    const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    if (last?.role !== 'tool' && tools.some((t) => t.name === 'search_document')) {
      return { content: null, toolCalls: [{ id: 'local-1', name: 'search_document', arguments: { query: question } }] }
    }
    const passages = messages
      .filter((m): m is Extract<Message, { role: 'tool' }> => m.role === 'tool')
      .map((m) => m.content)
      .join('\n\n')
    const best = bestSentences(question, passages, 3)
    const content = best.length
      ? `Offline mode: no language model is configured, so these are the sentences in the document that best match your question.\n\n${best
          .map((s) => `• ${s.text} (p. ${s.page})`)
          .join('\n')}`
      : 'Offline mode: I could not find anything relevant in the document.'
    return { content, toolCalls: [] }
  }
}

interface Sentence {
  text: string
  page: number
  score: number
}

/** "close" matches "closed", "rain" matches "rainy": a cheap stand-in for stemming. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return short.length >= 4 && long.startsWith(short) && long.length - short.length <= 3
}

/**
 * Splits retrieved "[p. N] ..." passages into sentences and ranks them by the
 * question terms they contain, weighting rare terms higher (IDF across the
 * candidate sentences). Weak matches below half the best score are dropped.
 */
export function bestSentences(question: string, passages: string, limit: number): Sentence[] {
  const terms = [...new Set(tokenize(question))]
  if (terms.length === 0) return []
  const candidates: { text: string; page: number; words: string[] }[] = []
  const seen = new Set<string>()
  for (const block of passages.split(/\n\n(?=\[p\. \d+\])/)) {
    const match = /^\[p\. (\d+)\]\s*/.exec(block)
    const page = match ? Number(match[1]) : 0
    const body = match ? block.slice(match[0].length) : block
    for (const raw of body.split(/(?<=[.!?])\s+/)) {
      const text = raw.trim()
      if (text.length < 20 || seen.has(text)) continue
      seen.add(text)
      candidates.push({ text, page, words: tokenize(text) })
    }
  }
  const has = (words: string[], term: string) => words.some((w) => sameWord(w, term))
  const idf = new Map(
    terms.map((t) => [t, Math.log(1 + candidates.length / (1 + candidates.filter((c) => has(c.words, t)).length))]),
  )
  const scored = candidates
    .map((c) => ({ text: c.text, page: c.page, score: terms.reduce((sum, t) => sum + (has(c.words, t) ? idf.get(t)! : 0), 0) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
  const top = scored[0]?.score ?? 0
  return scored.filter((s) => s.score >= top / 2).slice(0, limit)
}
