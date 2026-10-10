export interface Config {
  port: number
  openaiApiKey: string | undefined
  chatModel: string
  embeddingModel: string
  serpApiKey: string | undefined
  maxUploadBytes: number
  webDistDir: string | undefined
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 5001),
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    chatModel: env.OPENAI_CHAT_MODEL ?? 'gpt-5-mini',
    embeddingModel: env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    serpApiKey: env.SERPAPI_KEY || undefined,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 15) * 1024 * 1024,
    webDistDir: env.WEB_DIST_DIR || undefined,
  }
}
