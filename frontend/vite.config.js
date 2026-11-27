import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const here = import.meta.dirname

export default defineConfig({
  plugins: [react()],
  root: here,
  publicDir: resolve(here, 'public'),
  build: { outDir: resolve(here, '..', 'dist'), emptyOutDir: true },
  // npm run dev : les appels /api partent vers le backend Express local (PORT=3002)
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:3002' } },
})
