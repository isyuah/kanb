import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8400',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../server/webdist',
    emptyOutDir: true,
  },
})
