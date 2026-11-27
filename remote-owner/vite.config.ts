import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname),
  base: '/',
  publicDir: resolve(__dirname, 'public'),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'remote-owner-csp',
      apply: 'build',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'",
          },
          injectTo: 'head-prepend',
        },
      ],
    },
  ],
  build: {
    outDir: resolve(__dirname, '../remote-dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5174,
    strictPort: false,
  },
  preview: {
    port: 4174,
  },
})
