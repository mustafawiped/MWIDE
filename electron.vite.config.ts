import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      lib: {
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  preload: {
    build: {
      lib: {
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [
      react(),
      {
        name: 'mwide-production-csp',
        apply: 'build',
        transformIndexHtml() {
          return [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content: [
                  "default-src 'none'",
                  "script-src 'self'",
                  "style-src 'self'",
                  "img-src 'self' data:",
                  "font-src 'self'",
                  "connect-src 'none'",
                  "object-src 'none'",
                  "base-uri 'none'",
                  "form-action 'none'",
                  "frame-src 'none'",
                ].join('; '),
              },
              injectTo: 'head-prepend',
            },
          ]
        },
      },
    ],
  },
})
