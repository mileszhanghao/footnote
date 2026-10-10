import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { runAgent } from '../src/agent/agent.js'
import { ExtractiveChatModel, HashingEmbedder } from '../src/llm/local.js'
import type { ChatModel, Message, ModelTurn, ToolSpec } from '../src/llm/types.js'
import { McpToolSource } from '../src/mcp/mcpTools.js'
import { createWebSearchServer, trimResults } from '../src/mcp/webSearchServer.js'
import { DocumentService } from '../src/rag/documents.js'
import { makePdf, SAMPLE_PAGES } from './helpers.js'

/** A model that replays a fixed script of turns and records what it was shown. */
class ScriptedModel implements ChatModel {
  readonly name = 'scripted'
  readonly seenTools: string[][] = []
  readonly seenMessages: Message[][] = []

  constructor(private readonly turns: ModelTurn[]) {}

  async next(messages: Message[], tools: ToolSpec[]): Promise<ModelTurn> {
    this.seenTools.push(tools.map((t) => t.name))
    this.seenMessages.push(structuredClone(messages))
    const turn = this.turns.shift()
    if (!turn) throw new Error('script exhausted')
    return turn
  }
}

const serpResponse = {
  search_metadata: { id: 'x' },
  ads: [{ title: 'Ad' }],
  organic_results: [
    { title: 'Lean Startup - Wikipedia', link: 'https://en.wikipedia.org/wiki/Lean_startup', snippet: 'A methodology…' },
    { title: 'No link', snippet: 'dropped' },
    { title: 'Eric Ries', link: 'https://example.com/ries', snippet: 'Author', position: 3 },
  ],
}

async function connectWebSearch(fetchImpl: Parameters<typeof createWebSearchServer>[1]) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createWebSearchServer('test-key', fetchImpl).connect(serverSide)
  const tools = new McpToolSource(() => clientSide)
  await tools.connect()
  return tools
}

let open: McpToolSource[] = []
afterEach(async () => {
  await Promise.all(open.map((t) => t.close()))
  open = []
})

async function setup() {
  const documents = new DocumentService(new HashingEmbedder())
  const doc = await documents.ingestPdf('lean.pdf', await makePdf(SAMPLE_PAGES))
  return { documents, doc }
}

describe('web search MCP server', () => {
  it('lists search_web and returns only trimmed organic results', async () => {
    const calls: string[] = []
    const tools = await connectWebSearch(async (url) => {
      calls.push(url)
      return { ok: true, status: 200, json: async () => serpResponse }
    })
    open.push(tools)

    expect(tools.list().map((t) => t.name)).toEqual(['search_web'])
    const result = await tools.call('search_web', { query: 'lean startup', num: 2 })
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.text)).toEqual([
      { title: 'Lean Startup - Wikipedia', link: 'https://en.wikipedia.org/wiki/Lean_startup', snippet: 'A methodology…' },
      { title: 'Eric Ries', link: 'https://example.com/ries', snippet: 'Author' },
    ])
    expect(new URL(calls[0]!).searchParams.get('q')).toBe('lean startup')
  })

  it('reports upstream failures as tool errors instead of crashing', async () => {
    const tools = await connectWebSearch(async () => ({ ok: false, status: 429, json: async () => ({}) }))
    open.push(tools)
    const result = await tools.call('search_web', { query: 'x' })
    expect(result).toMatchObject({ isError: true })
    expect(result.text).toContain('429')
  })

  it('trimResults tolerates missing fields', () => {
    expect(trimResults(undefined, 5)).toEqual([])
  })
})

describe('runAgent', () => {
  it('lets the model choose tools: document first, then web, then answer with citations', async () => {
    const { documents, doc } = await setup()
    const mcpTools = await connectWebSearch(async () => ({ ok: true, status: 200, json: async () => serpResponse }))
    open.push(mcpTools)
    const model = new ScriptedModel([
      { content: null, toolCalls: [{ id: '1', name: 'search_document', arguments: { query: 'minimum viable product' } }] },
      { content: null, toolCalls: [{ id: '2', name: 'search_web', arguments: { query: 'who wrote the lean startup' } }] },
      { content: 'An MVP tests the riskiest assumptions (p. 1). The book is by Eric Ries.', toolCalls: [] },
    ])

    const result = await runAgent({ model, documents, mcpTools }, doc.id, 'What is an MVP and who wrote this?')

    expect(model.seenTools[0]).toEqual(['search_document', 'search_web'])
    expect(result.steps.map((s) => [s.tool, s.ok])).toEqual([
      ['search_document', true],
      ['search_web', true],
    ])
    expect(result.answer).toContain('Eric Ries')
    expect(result.citations).toContainEqual(expect.objectContaining({ type: 'document', page: 1 }))
    expect(result.citations).toContainEqual({ type: 'web', title: 'Eric Ries', url: 'https://example.com/ries' })

    // The document passages the model saw carry page labels it can cite.
    const toolMessage = model.seenMessages[1]!.find((m) => m.role === 'tool')
    expect(toolMessage?.role === 'tool' && toolMessage.content).toMatch(/^\[p\. 1\]/)
  })

  it('answers without web search when the model does not ask for it', async () => {
    const { documents, doc } = await setup()
    const model = new ScriptedModel([
      { content: null, toolCalls: [{ id: '1', name: 'search_document', arguments: { query: 'pivot' } }] },
      { content: 'Teams pivot when evidence contradicts the hypothesis (p. 2).', toolCalls: [] },
    ])
    const result = await runAgent({ model, documents }, doc.id, 'When do teams pivot?')
    expect(result.steps).toHaveLength(1)
    expect(result.citations.every((c) => c.type === 'document')).toBe(true)
  })

  it('feeds unknown-tool errors back to the model and stops at the step limit', async () => {
    const { documents, doc } = await setup()
    const looping: ModelTurn = { content: null, toolCalls: [{ id: 'x', name: 'delete_everything', arguments: {} }] }
    const model = new ScriptedModel([looping, looping, looping])
    const result = await runAgent({ model, documents, maxSteps: 3 }, doc.id, 'hi')
    expect(result.steps.every((s) => !s.ok)).toBe(true)
    expect(result.answer).toMatch(/step limit/)
  })

  it('runs end to end offline with the extractive model', async () => {
    const { documents, doc } = await setup()
    const result = await runAgent({ model: new ExtractiveChatModel(), documents }, doc.id, 'release cycles feedback')
    expect(result.answer).toMatch(/^Offline mode/)
    expect(result.citations[0]).toMatchObject({ type: 'document', page: 3 })
  })
})
