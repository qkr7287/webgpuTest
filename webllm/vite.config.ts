import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: {
    port: 5400,
    headers: {
      // SharedArrayBuffer 사용을 위한 COOP/COEP 헤더
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        '3d-ai-scene': resolve(__dirname, '3d-ai-scene/index.html'),
      },
    },
  },
})
