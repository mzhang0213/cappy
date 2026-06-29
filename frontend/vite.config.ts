import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3615,
    allowedHosts: ['pc.mzhang.dev'],
    // Proxy API + HLS to the backend so the dev server works on its own,
    // without needing nginx in front.
    proxy: {
      '/server': {
        target: 'http://localhost:3672',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/server/, ''),
      },
      '/hls': {
        target: 'http://localhost:3672',
        changeOrigin: true,
      },
    },
  },
})
