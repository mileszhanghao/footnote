import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ToolSpec } from '../llm/types.js'

export interface ToolResult {
  text: string
  isError: boolean
}

/**
 * Connects to an MCP server once and exposes its tools to the agent. The tool
 * list comes from the server (tools/list), so adding a tool to the server
 * makes it available to the agent without changing this code.
 */
export class McpToolSource {
  private client: Client | null = null
  private tools: ToolSpec[] = []

  constructor(private readonly makeTransport: () => Transport) {}

  async connect(): Promise<void> {
    const client = new Client({ name: 'footnote', version: '1.0.0' })
    await client.connect(this.makeTransport())
    const { tools } = await client.listTools()
    this.tools = tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema as Record<string, unknown>,
    }))
    this.client = client
  }

  list(): ToolSpec[] {
    return this.tools
  }

  has(name: string): boolean {
    return this.tools.some((t) => t.name === name)
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.client) throw new Error('MCP client is not connected')
    const result = await this.client.callTool({ name, arguments: args })
    const content = (result.content ?? []) as { type: string; text?: string }[]
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
    return { text, isError: Boolean(result.isError) }
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = null
  }
}
