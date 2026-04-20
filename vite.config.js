import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/korea': {
        target: 'https://pokemoncard.co.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/korea/, '')
      }
    }
  }
})
