// Runs the server's own RAG pipeline in the browser: the same chunker, hashing
// embedder, vector store and agent loop, with the offline extractive model in
// place of an LLM. Nothing leaves the page; uploaded PDFs stay in memory.
import { runAgent } from '../../../server/src/agent/agent.ts'
import { ExtractiveChatModel, HashingEmbedder } from '../../../server/src/llm/local.ts'
import { DocumentError, DocumentService } from '../../../server/src/rag/documents.ts'
import type { Api, DocumentInfo } from '../api'

export const SAMPLE_FILE = 'night-owl-handbook.pdf'
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

const documents = new DocumentService(new HashingEmbedder())
const model = new ExtractiveChatModel()
let sample: Promise<DocumentInfo | null> | null = null

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

/** Indexes the bundled sample PDF once, so visitors can ask questions right away. */
function ensureSample(load = fetchBytes): Promise<DocumentInfo | null> {
  sample ??= load(`${import.meta.env.BASE_URL}${SAMPLE_FILE}`)
    .then((bytes) => documents.ingestPdf(SAMPLE_FILE, bytes))
    .catch(() => null)
  return sample
}

export function createDemoApi(load = fetchBytes): Api {
  return {
    health: async () => ({ status: 'ok', model: 'local:extractive', embedder: 'local:hashing', webSearch: false }),
    documents: async () => {
      await ensureSample(load)
      return documents.list()
    },
    upload: async (file) => {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error('PDF is larger than 20 MB')
      try {
        return await documents.ingestPdf(file.name, new Uint8Array(await file.arrayBuffer()))
      } catch (error) {
        throw new Error(error instanceof DocumentError ? error.message : 'Could not read this PDF')
      }
    },
    ask: (documentId, question) => runAgent({ model, documents }, documentId, question),
  }
}

export const demoApi = createDemoApi()
