export interface DocumentInfo {
  id: string
  name: string
  pages: number
  chunks: number
  uploadedAt: string
}

export type Citation =
  | { type: 'document'; page: number; excerpt: string }
  | { type: 'web'; title: string; url: string }

export interface AgentAnswer {
  answer: string
  citations: Citation[]
  steps: { tool: string; arguments: Record<string, unknown>; ok: boolean }[]
  model: string
}

export interface Health {
  status: string
  model: string
  embedder: string
  webSearch: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init)
  const body = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error((body as { error?: string } | undefined)?.error ?? `Request failed (${response.status})`)
  }
  return body as T
}

export interface Api {
  health(): Promise<Health>
  documents(): Promise<DocumentInfo[]>
  upload(file: File): Promise<DocumentInfo>
  ask(documentId: string, question: string): Promise<AgentAnswer>
}

/** GitHub Pages build: no server, the RAG pipeline runs in the browser. */
export const IS_DEMO = import.meta.env.VITE_DEMO === 'true'

const httpApi: Api = {
  health: () => request<Health>('/health'),
  documents: () => request<DocumentInfo[]>('/documents'),
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<DocumentInfo>('/documents', { method: 'POST', body: form })
  },
  ask: (documentId: string, question: string) =>
    request<AgentAnswer>('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, question }),
    }),
}

// The demo module (PDF parser included) is only bundled into the demo build.
const demo = () => import('./demo/demoApi').then((m) => m.demoApi)
const demoApi: Api = {
  health: async () => (await demo()).health(),
  documents: async () => (await demo()).documents(),
  upload: async (file) => (await demo()).upload(file),
  ask: async (id, q) => (await demo()).ask(id, q),
}

export const api: Api = IS_DEMO ? demoApi : httpApi
