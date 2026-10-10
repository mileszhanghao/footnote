import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import OpenAI from 'openai'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { ExtractiveChatModel, HashingEmbedder } from './llm/local.js'
import { OpenAIChatModel, OpenAIEmbedder } from './llm/openai.js'
import type { ChatModel, Embedder } from './llm/types.js'
import { McpToolSource } from './mcp/mcpTools.js'
import { DocumentService } from './rag/documents.js'

const config = loadConfig()
const here = path.dirname(fileURLToPath(import.meta.url))

let model: ChatModel
let embedder: Embedder
if (config.openaiApiKey) {
  const client = new OpenAI({ apiKey: config.openaiApiKey })
  model = new OpenAIChatModel(client, config.chatModel)
  embedder = new OpenAIEmbedder(client, config.embeddingModel)
} else {
  console.warn('OPENAI_API_KEY not set: running in offline mode (lexical search, extractive answers)')
  model = new ExtractiveChatModel()
  embedder = new HashingEmbedder()
}

let mcpTools: McpToolSource | undefined
if (config.serpApiKey) {
  // Spawn the MCP server as a child process and talk to it over stdio.
  const isTs = import.meta.url.endsWith('.ts')
  const serverEntry = path.join(here, 'mcp', isTs ? 'web-search.ts' : 'web-search.js')
  mcpTools = new McpToolSource(
    () =>
      new StdioClientTransport({
        command: process.execPath,
        args: isTs ? ['--import', 'tsx', serverEntry] : [serverEntry],
        env: { ...process.env } as Record<string, string>,
      }),
  )
  await mcpTools.connect()
  console.log(`MCP web search connected: ${mcpTools.list().map((t) => t.name).join(', ')}`)
}

const app = createApp({
  model,
  documents: new DocumentService(embedder),
  ...(mcpTools && { mcpTools }),
  maxUploadBytes: config.maxUploadBytes,
  ...(config.webDistDir && { webDistDir: config.webDistDir }),
  capabilities: { model: model.name, embedder: embedder.name, webSearch: Boolean(mcpTools) },
})

app.listen(config.port, () => console.log(`Footnote server on http://localhost:${config.port}`))
