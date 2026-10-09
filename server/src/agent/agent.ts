import type { ChatModel, Message, ToolSpec } from '../llm/types.js'
import type { McpToolSource } from '../mcp/mcpTools.js'
import type { DocumentService } from '../rag/documents.js'
import type { WebResult } from '../mcp/webSearchServer.js'

export interface DocumentCitation {
  type: 'document'
  page: number
  excerpt: string
}

export interface WebCitation {
  type: 'web'
  title: string
  url: string
}

export type Citation = DocumentCitation | WebCitation

export interface ToolStep {
  tool: string
  arguments: Record<string, unknown>
  ok: boolean
}

export interface AgentAnswer {
  answer: string
  citations: Citation[]
  steps: ToolStep[]
  model: string
}

const SEARCH_DOCUMENT: ToolSpec = {
  name: 'search_document',
  description:
    "Search the user's uploaded PDF for passages relevant to a query. Use this first for any question about the document.",
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to look for in the document' } },
    required: ['query'],
  },
}

const SYSTEM_PROMPT = `You answer questions about the user's uploaded PDF.
- Use search_document to find relevant passages. Search again with different wording if the first results don't answer the question.
- Use search_web only if the question needs current or outside information that the document cannot provide.
- Base your answer on tool results. If they don't contain the answer, say you don't know.
- Cite document passages as (p. N) and web results by their title.
- Keep answers concise.`

export interface AgentDeps {
  model: ChatModel
  documents: DocumentService
  /** Optional MCP tools (e.g. web search). The agent works without them. */
  mcpTools?: McpToolSource
  maxSteps?: number
}

/**
 * A small tool-calling loop: the model sees the available tools, decides what
 * to call, gets the results, and repeats until it answers or runs out of
 * steps. The course version always ran a web search for every question and
 * returned two separate answers; here the model decides what it needs.
 */
export async function runAgent(deps: AgentDeps, documentId: string, question: string): Promise<AgentAnswer> {
  const { model, documents, mcpTools, maxSteps = 5 } = deps
  const tools = [SEARCH_DOCUMENT, ...(mcpTools?.list() ?? [])]
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ]
  const citations: Citation[] = []
  const steps: ToolStep[] = []

  for (let step = 0; step < maxSteps; step++) {
    const turn = await model.next(messages, tools)
    if (turn.toolCalls.length === 0) {
      return { answer: turn.content ?? '', citations: dedupe(citations), steps, model: model.name }
    }
    messages.push({ role: 'assistant', content: turn.content, toolCalls: turn.toolCalls })

    for (const call of turn.toolCalls) {
      let output: string
      let ok = true
      try {
        if (call.name === SEARCH_DOCUMENT.name) {
          const query = String(call.arguments.query ?? question)
          const hits = await documents.search(documentId, query)
          hits.forEach((h) => citations.push({ type: 'document', page: h.page, excerpt: h.text.slice(0, 280) }))
          output = hits.map((h) => `[p. ${h.page}] ${h.text}`).join('\n\n') || 'No matching passages.'
        } else if (mcpTools?.has(call.name)) {
          const result = await mcpTools.call(call.name, call.arguments)
          ok = !result.isError
          output = result.text
          if (ok && call.name === 'search_web') citations.push(...webCitations(result.text))
        } else {
          ok = false
          output = `Unknown tool: ${call.name}`
        }
      } catch (error) {
        ok = false
        output = `Tool failed: ${(error as Error).message}`
      }
      steps.push({ tool: call.name, arguments: call.arguments, ok })
      messages.push({ role: 'tool', toolCallId: call.id, content: output })
    }
  }

  return {
    answer: 'I could not finish answering within the step limit. Try a more specific question.',
    citations: dedupe(citations),
    steps,
    model: model.name,
  }
}

function webCitations(text: string): WebCitation[] {
  try {
    return (JSON.parse(text) as WebResult[]).map((r) => ({ type: 'web', title: r.title, url: r.link }))
  } catch {
    return []
  }
}

function dedupe(citations: Citation[]): Citation[] {
  const seen = new Set<string>()
  return citations.filter((c) => {
    const key = c.type === 'document' ? `d:${c.page}:${c.excerpt}` : `w:${c.url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
