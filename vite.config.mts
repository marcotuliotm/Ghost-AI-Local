import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import path from 'path'
import type { Plugin } from 'vite'
import { contentSecurityPolicy } from './src/lib/csp'

// Inject the renderer's Content-Security-Policy: a strict one in the build, a
// relaxed one in dev (Vite's inline React-refresh preamble and HMR socket).
function csp(): Plugin {
  return {
    name: 'ghost-csp',
    transformIndexHtml(_html, ctx) {
      return [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(Boolean(ctx.server)) },
        injectTo: 'head-prepend',
      }]
    },
  }
}

export default defineConfig({
  plugins: [
    csp(),
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'electron-store', '@huggingface/transformers', 'onnxruntime-node', 'unpdf'],
              output: {
                format: 'cjs',
              },
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
              },
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },
})
