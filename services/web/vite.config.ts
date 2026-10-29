import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

// In production the Express server generates /config.js from API_BASE_URL.
// During `vite dev` this tiny plugin does the same from VITE_API_BASE_URL
// (default: the compose api on localhost:3000), so the app code never needs
// a dev-only branch.
function runtimeConfig(): Plugin {
  return {
    name: 'microshort-runtime-config',
    configureServer(server) {
      server.middlewares.use('/config.js', (_req, res) => {
        const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://localhost:3000'
        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Cache-Control', 'no-store')
        res.end(`window.MICROSHORT_CONFIG = ${JSON.stringify({ apiBaseUrl })};`)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), runtimeConfig()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
