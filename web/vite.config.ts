import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'vibe-i18n': new URL('./src/i18n', import.meta.url).pathname,
    },
  },
  // Three.js is isolated behind React.lazy and is fetched only when a mesh
  // workspace is opened. Its self-contained renderer chunk is intentionally
  // larger than the generic 500 kB default while the initial app stays small.
  build: {
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:9292',
    },
  },
})
