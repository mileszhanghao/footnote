/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // src/demo imports server/src modules; resolve their dependencies from web/node_modules.
  resolve: { dedupe: ['unpdf'] },
  server: {
    proxy: { '/api': 'http://localhost:5001' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
