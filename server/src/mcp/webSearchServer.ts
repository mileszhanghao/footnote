import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export interface WebResult {
  title: string
  link: string
  snippet: string
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * MCP server exposing one tool, search_web, backed by SerpAPI.
 *
 * It returns only title, link and snippet for the top results. The course
 * version passed SerpAPI's entire JSON response (ads, metadata, every field)
 * to the model, which wastes tokens and buries the useful part.
 */
export function createWebSearchServer(apiKey: string, fetchImpl: FetchLike = fetch): McpServer {
  const server = new McpServer({ name: 'web-search', version: '1.0.0' })

  server.registerTool(
    'search_web',
    {
      description:
        'Search the public web for current or general information that is not in the uploaded document. Returns the top results with title, link and snippet.',
      inputSchema: {
        query: z.string().min(1).describe('The search query'),
        num: z.number().int().min(1).max(10).optional().describe('How many results to return (default 5)'),
      },
    },
    async ({ query, num = 5 }) => {
      const url = new URL('https://serpapi.com/search.json')
      url.search = new URLSearchParams({ engine: 'google', q: query, num: String(num), api_key: apiKey }).toString()
      try {
        const response = await fetchImpl(url.toString())
        if (!response.ok) throw new Error(`SerpAPI returned HTTP ${response.status}`)
        const results = trimResults(await response.json(), num)
        return { content: [{ type: 'text', text: JSON.stringify(results) }] }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Web search failed: ${(error as Error).message}` }],
        }
      }
    },
  )

  return server
}

export function trimResults(body: unknown, limit: number): WebResult[] {
  const organic = (body as { organic_results?: unknown[] })?.organic_results ?? []
  return organic
    .map((r) => r as Partial<WebResult>)
    .filter((r) => r.title && r.link)
    .slice(0, limit)
    .map((r) => ({ title: String(r.title), link: String(r.link), snippet: String(r.snippet ?? '') }))
}
