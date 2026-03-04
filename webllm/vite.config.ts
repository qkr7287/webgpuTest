import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5400,
    headers: {
      // SharedArrayBuffer 사용을 위한 COOP/COEP 헤더
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
