# Footnote¹

Upload a PDF and ask questions about it. An LLM agent decides which tools it needs: searching the document, searching the web through an MCP server, or both. Every answer comes with footnotes, meaning page citations and source links.

**Live demo:** https://mileszhanghao.github.io/footnote/ runs the retrieval pipeline entirely in your browser, so your PDF never leaves your computer. That pipeline is PDF parsing, chunking, hashing embeddings, vector search and the agent loop, using the same TypeScript modules as the server. With no language model in the browser, demo answers are the best-matching sentences with their page numbers. A sample PDF is preloaded: a fictional handbook for [SiuYeh](https://github.com/mileszhanghao/siuyeh), my late-night food-ordering app. Try "How much does delivery cost?" or upload your own PDF.

**Stack:** TypeScript · Node 22 · Express 5 · OpenAI API (tool calling + embeddings) · Model Context Protocol (official TypeScript SDK) · React 19 · Vite · Ant Design · TanStack Query · Vitest · Supertest · Docker · GitHub Actions

## Background

It also replaces an earlier, simpler version of the same idea: **Next AI** (LaiOffer, December 2024). Next AI was a LangChain + Express server that answered questions about one uploaded PDF, with a React UI and a voice chat mode. Everything it did is covered here.

I first built the current version in LaiOffer's Agent AI course (2025), where it was called AgentAI: an Express server using LangChain for PDF question answering, a separate MCP server wrapping SerpAPI web search, and a React UI with voice input. In 2026 I rebuilt it to fix the problems I found when re-reading the original code. The rebuild was developed with AI pair-programming assistance (Claude).

## What changed from the course version, and why

| Problem in the course version | What the rebuild does |
|---|---|
| Every question re-read the PDF, re-split it and re-embedded every chunk before answering, so each question paid the full indexing cost again. | The PDF is parsed, chunked and embedded once at upload. A question embeds only the question. |
| The server stored the "current" file in one global variable, so every user shared one document, and an upload replaced the file for everyone. | Each upload gets its own ID and index. Chat requests name the document they are about. |
| The "MCP answer" ran a web search for every question, whether or not it was useful, and returned it as a second, separate answer. | A real tool-calling loop: the model is given `search_document` plus whatever tools the MCP server lists, decides what to call, and writes one answer. A step limit stops runaway loops. |
| The entire SerpAPI JSON response (ads, metadata, every field) was passed to the model. | The MCP tool returns only title, link and snippet for the top results. |
| Answers had no sources. | Answers cite PDF pages (with the matching excerpt) and web links. The UI also shows each tool call the agent made. |
| Uploads were saved to disk under the user's own filename, with no type or size limit. | Uploads stay in memory, must be PDFs, are size-limited (413 when too large), and names are sanitized for display only. |
| 500-character chunks with no overlap cut sentences in half. | ~900-character chunks with 150 characters of overlap, broken at paragraph or sentence boundaries, never spanning two pages. |
| The questions went in the URL query string (`GET /chat?question=…`). | `POST /api/chat` with a validated JSON body. |
| Nothing ran without OpenAI and SerpAPI keys, and there were no tests. | An **offline mode** (local hashing embeddings + extractive answers) runs with no keys. Tests cover chunking, retrieval, answer extraction, the agent loop, the MCP server, the HTTP API and the in-browser demo. |
| Voice used two third-party packages. | The browser's built-in Web Speech API for speech input and spoken answers. |

## Architecture

```
React UI ──/api──► Express server ──► DocumentService ──► chunker ─► embedder ─► in-memory vector index
                        │
                        └─► agent loop ──► ChatModel (OpenAI tool calling)
                                 │
                                 ├─ search_document  (local tool → vector index)
                                 └─ search_web       (MCP client ──stdio──► MCP server ──► SerpAPI)
```

- `server/src/rag/` — PDF text extraction (unpdf), page-aware chunking, cosine-similarity vector index.
- `server/src/agent/agent.ts` — the tool-calling loop and citation collection.
- `server/src/mcp/` — the web-search MCP server (also runnable on its own by any MCP client) and the MCP client that turns its tools into agent tools.
- `server/src/llm/` — `ChatModel` / `Embedder` interfaces with OpenAI and offline implementations.
- `web/src/demo/` — the GitHub Pages demo. It imports the server's RAG and agent modules directly, so the demo and the server cannot drift apart. Those modules use only portable code (Web Crypto, a pure-JS hash, no Node built-ins) for this reason.

## Running it

```bash
cp .env.example server/.env            # optionally add OPENAI_API_KEY and SERPAPI_KEY
cd server && npm install && npm run dev       # API on :5001
cd web && npm install && npm run dev          # UI on :5173, proxies /api to :5001
```

With Docker (API and UI in one container):

```bash
docker build -t footnote .
docker run -p 5001:5001 -e OPENAI_API_KEY=... -e SERPAPI_KEY=... footnote
# open http://localhost:5001
```

Without keys it starts in offline mode, and the UI says so.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Which model, embedder and tools are active |
| POST | `/api/documents` | Upload a PDF (`multipart/form-data`, field `file`) |
| GET | `/api/documents` | List uploaded documents |
| DELETE | `/api/documents/{id}` | Remove a document and its index |
| POST | `/api/chat` | `{ "documentId", "question" }` → answer, citations, agent steps |

## Tests

```bash
cd server && npm test   # chunking, retrieval, agent loop, MCP server over an in-memory transport, HTTP API
cd web && npm test
```

The agent tests use a scripted model, so they check the loop's behavior (tool choice, error handling, step limit, citations) without calling OpenAI. The MCP tests connect a real MCP client and server over an in-memory transport with a stubbed SerpAPI.

## Limitations and next steps

- The vector index lives in memory, so documents are lost on restart. The store sits behind a small interface; pgvector would be the next step.
- Scanned PDFs (images only) have no text layer, and the server rejects them with a clear message. OCR is not implemented.
