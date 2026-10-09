import { createHash } from 'node:crypto'
import type { ChatModel, Embedder, Message, ModelTurn, ToolSpec } from './types.js'

/**
 * Offline embedder: hashes word unigrams and bigrams into a fixed-size vector
 * (the "hashing trick"). No API key, fully deterministic — used for tests and
 * when OPENAI_API_KEY is not set. Retrieval quality is lexical, not semantic.
 */
export class HashingEmbedder implements Embedder {
  readonly name = 'local:hashing'

  constructor(private readonly dimensions = 1024) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text))
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0)
    const words = tokenize(text)
    const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)]
    for (const feature of features) {
      const hash = createHash('md5').update(feature).digest()
      const bucket = hash.readUInt32BE(0) % this.dimensions
      const sign = hash[4]! & 1 ? 1 : -1
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

function tokenize(text: string): string[] {
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
    const content = passages.trim()
      ? `Offline mode (no OpenAI key configured), so here are the most relevant passages instead of a generated answer:\n\n${passages}`
      : 'Offline mode: I could not find anything relevant in the document.'
    return { content, toolCalls: [] }
  }
}
