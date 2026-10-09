import express, { type ErrorRequestHandler } from 'express'
import multer from 'multer'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { runAgent, type AgentDeps } from './agent/agent.js'
import { DocumentError } from './rag/documents.js'

export interface AppOptions extends AgentDeps {
  maxUploadBytes: number
  webDistDir?: string
  /** Shown on /api/health so the UI can tell the user which mode it is in. */
  capabilities: { model: string; embedder: string; webSearch: boolean }
}

const ChatBody = z.object({
  documentId: z.string().uuid(),
  question: z.string().trim().min(1).max(2000),
})

export function createApp(options: AppOptions) {
  const { documents, maxUploadBytes, webDistDir, capabilities } = options
  const app = express()
  app.use(express.json({ limit: '32kb' }))

  // Files stay in memory and are discarded after indexing; nothing is written
  // to disk under a user-supplied name (the course version did exactly that).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
  })

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', ...capabilities })
  })

  app.get('/api/documents', (_req, res) => {
    res.json(documents.list())
  })

  app.post('/api/documents', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Upload one PDF in the "file" field' })
      return
    }
    const info = await documents.ingestPdf(req.file.originalname, new Uint8Array(req.file.buffer))
    res.status(201).json(info)
  })

  app.delete('/api/documents/:id', (req, res) => {
    res.status(documents.remove(req.params.id) ? 204 : 404).end()
  })

  // POST with a JSON body: the question is user content and does not belong in a URL.
  app.post('/api/chat', async (req, res) => {
    const parsed = ChatBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      return
    }
    const { documentId, question } = parsed.data
    if (!documents.get(documentId)) {
      res.status(404).json({ error: 'Document not found' })
      return
    }
    res.json(await runAgent(options, documentId, question))
  })

  if (webDistDir && existsSync(webDistDir)) {
    app.use(express.static(webDistDir))
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDistDir, 'index.html')))
  }

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      const tooBig = error.code === 'LIMIT_FILE_SIZE'
      res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `PDF is larger than ${Math.round(maxUploadBytes / 1024 / 1024)} MB` : error.message,
      })
      return
    }
    if (error instanceof DocumentError) {
      res.status(422).json({ error: error.message })
      return
    }
    console.error(error)
    res.status(500).json({ error: 'Something went wrong' })
  }
  app.use(errorHandler)

  return app
}
