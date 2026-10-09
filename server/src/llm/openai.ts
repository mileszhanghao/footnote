import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ChatModel, Embedder, Message, ModelTurn, ToolSpec } from './types.js'

export class OpenAIEmbedder implements Embedder {
  readonly name: string

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {
    this.name = `openai:${model}`
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = []
    // Batch to stay well under the per-request input limit.
    for (let i = 0; i < texts.length; i += 128) {
      const response = await this.client.embeddings.create({ model: this.model, input: texts.slice(i, i + 128) })
      vectors.push(...response.data.map((d) => d.embedding))
    }
    return vectors
  }
}

export class OpenAIChatModel implements ChatModel {
  readonly name: string

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {
    this.name = `openai:${model}`
  }

  async next(messages: Message[], tools: ToolSpec[]): Promise<ModelTurn> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map(toOpenAI),
      ...(tools.length > 0 && { tools: tools.map(toOpenAITool) }),
    })
    const message = response.choices[0]?.message
    if (!message) throw new Error('OpenAI returned no choices')
    const toolCalls = (message.tool_calls ?? [])
      .filter((call) => call.type === 'function')
      .map((call) => ({ id: call.id, name: call.function.name, arguments: parseArgs(call.function.arguments) }))
    return { content: message.content ?? null, toolCalls }
  }
}

function toOpenAI(message: Message): ChatCompletionMessageParam {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: message.content }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length && {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        }),
      }
  }
}

function toOpenAITool(tool: ToolSpec): ChatCompletionTool {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
