import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: {
          index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
          'project-folder-worker': fileURLToPath(
            new URL('./src/main/project-folder-worker.ts', import.meta.url),
          ),
        },
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          entryFileNames: '[name].cjs',
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
