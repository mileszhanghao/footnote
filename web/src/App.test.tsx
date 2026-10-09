import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { App as AntApp } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const DOC = { id: 'd1', name: 'lean.pdf', pages: 3, chunks: 6, uploadedAt: '2026-10-09T00:00:00Z' }

function mockServer(chat: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (url === '/api/health') return json({ status: 'ok', model: 'local:extractive', embedder: 'local:hashing', webSearch: false })
    if (url === '/api/documents') return json([DOC])
    if (url === '/api/chat' && init?.method === 'POST') return json(chat)
    return new Response(null, { status: 404 })
  })
}

function renderApp() {
  render(
    <AntApp>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>
    </AntApp>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('App', () => {
  it('shows offline mode, asks a question, and renders citations and agent steps', async () => {
    const fetchSpy = mockServer({
      answer: 'An MVP tests the riskiest assumptions.',
      citations: [
        { type: 'document', page: 1, excerpt: 'Founders build a minimum viable product…' },
        { type: 'web', title: 'Lean startup - Wikipedia', url: 'https://en.wikipedia.org/wiki/Lean_startup' },
      ],
      steps: [{ tool: 'search_document', arguments: { query: 'MVP' }, ok: true }],
      model: 'local:extractive',
    })
    renderApp()

    expect(await screen.findByText('Offline mode')).toBeInTheDocument()
    expect(await screen.findByText('lean.pdf · 3 pages')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('Ask about the document…')
    fireEvent.change(input, { target: { value: 'What is an MVP?' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })

    expect(await screen.findByText('An MVP tests the riskiest assumptions.')).toBeInTheDocument()
    expect(screen.getByText('p. 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lean startup - Wikipedia' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Lean_startup',
    )
    expect(screen.getByText(/Agent steps \(1\)/)).toBeInTheDocument()

    const chatCall = fetchSpy.mock.calls.find(([url]) => url === '/api/chat')
    expect(JSON.parse(String(chatCall?.[1]?.body))).toEqual({ documentId: 'd1', question: 'What is an MVP?' })
  })
})
