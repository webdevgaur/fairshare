import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  optimizeDeps: {
    // @noble/* packages use exports subpaths that esbuild's dep pre-bundling
    // fails to resolve (e.g. './sha2' vs './sha2.js'); serving them un-optimized
    // avoids intermittent dev-server errors. The production build resolves fine.
    exclude: ['@noble/hashes', '@noble/ed25519'],
  },
})