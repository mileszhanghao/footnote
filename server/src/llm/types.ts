/** Turns text into vectors for similarity search. */
export interface Embedder {
  readonly name: string
  embed(texts: string[]): Promise<number[][]>
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ModelTurn {
  /** Final answer text, when the model is done. */
  content: string | null
  /** Tools the model wants run before it answers. */
  toolCalls: ToolCall[]
}

/** A chat model that can decide to call tools. */
export interface ChatModel {
  readonly name: string
  next(messages: Message[], tools: ToolSpec[]): Promise<ModelTurn>
}
