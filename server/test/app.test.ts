import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { ExtractiveChatModel, HashingEmbedder } from '../src/llm/local.js'
import { DocumentService } from '../src/rag/documents.js'
import { makePdf, SAMPLE_PAGES } from './helpers.js'

function makeApp(maxUploadBytes = 1024 * 1024) {
  return createApp({
    model: new ExtractiveChatModel(),
    documents: new DocumentService(new HashingEmbedder()),
    maxUploadBytes,
    capabilities: { model: 'local:extractive', embedder: 'local:hashing', webSearch: false },
  })
}

describe('HTTP API', () => {
  it('uploads a PDF, lists it, and answers a question with page citations', async () => {
    const app = makeApp()
    const pdf = Buffer.from(await makePdf(SAMPLE_PAGES))

    const upload = await request(app)
      .post('/api/documents')
      .attach('file', pdf, { filename: 'lean.pdf', contentType: 'application/pdf' })
    expect(upload.status).toBe(201)
    expect(upload.body).toMatchObject({ name: 'lean.pdf', pages: 3 })

    const list = await request(app).get('/api/documents')
    expect(list.body).toHaveLength(1)

    const chat = await request(app)
      .post('/api/chat')
      .send({ documentId: upload.body.id, question: 'What does customer development mean?' })
    expect(chat.status).toBe(200)
    expect(chat.body.citations[0]).toMatchObject({ type: 'document', page: 2 })
    expect(chat.body.steps).toEqual([{ tool: 'search_document', arguments: expect.any(Object), ok: true }])
  })

  it('rejects non-PDF uploads, oversized uploads and unreadable PDFs', async () => {
    const app = makeApp(2000)
    const text = await request(app)
      .post('/api/documents')
      .attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
    expect(text.status).toBe(400)

    const big = await request(app)
      .post('/api/documents')
      .attach('file', Buffer.alloc(5000), { filename: 'big.pdf', contentType: 'application/pdf' })
    expect(big.status).toBe(413)

    const fake = await request(app)
      .post('/api/documents')
      .attach('file', Buffer.from('%PDF-not really'), { filename: 'x.pdf', contentType: 'application/pdf' })
    expect(fake.status).toBe(422)
  })

  it('validates chat requests', async () => {
    const app = makeApp()
    expect((await request(app).post('/api/chat').send({ question: 'hi' })).status).toBe(400)
    const unknown = await request(app)
      .post('/api/chat')
      .send({ documentId: '00000000-0000-4000-8000-000000000000', question: 'hi' })
    expect(unknown.status).toBe(404)
  })

  it('reports which mode it runs in', async () => {
    const health = await request(makeApp()).get('/api/health')
    expect(health.body).toEqual({
      status: 'ok',
      model: 'local:extractive',
      embedder: 'local:hashing',
      webSearch: false,
    })
  })
})
