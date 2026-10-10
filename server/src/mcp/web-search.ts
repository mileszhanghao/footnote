// Entry point for running the web-search MCP server as its own process over
// stdio. The API server spawns it; any MCP client (e.g. Claude Desktop) can too.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createWebSearchServer } from './webSearchServer.js'

const apiKey = process.env.SERPAPI_KEY
if (!apiKey) {
  console.error('SERPAPI_KEY is not set')
  process.exit(1)
}

await createWebSearchServer(apiKey).connect(new StdioServerTransport())
console.error('web-search MCP server running on stdio')
