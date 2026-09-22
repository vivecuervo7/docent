import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // refractor (syntax highlighting) is an older CJS package that references
  // Node's `global` directly; browsers don't have one, so alias it to
  // `globalThis`, the standard workaround for this class of legacy package.
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
