import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// kuromoji/kuroshiro decompress dictionaries with zlibjs, whose minified UMD
// build is one big `(function(){ var aa=this; ... }).call(this)` with no
// CommonJS branch — it assumes `this` is the global object. In an ES module
// `this` is undefined, so it throws "Cannot use 'in' operator to search for
// 'Zlib' in undefined" at import time, which breaks the whole app. Rewrite the
// trailing `.call(this)` to fall back to globalThis.
const zlibjsThisShim = {
  name: 'zlibjs-this-shim',
  setup(build: { onLoad: (opts: { filter: RegExp }, cb: (args: { path: string }) => { contents: string; loader: 'js' }) => void }) {
    build.onLoad({ filter: /zlibjs[\\/].*\.js$/ }, (args) => {
      const code = readFileSync(args.path, 'utf8')
      return {
        contents: code.replace(/\}\)\.call\(this\);(\s*)$/, '}).call(this||globalThis);$1'),
        loader: 'js',
      }
    })
  },
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        runtimeCaching: [
          {
            urlPattern: /\/models\/.*\.onnx$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ai-models-v1',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: 'Utasync',
        short_name: 'Utasync',
        description: 'Learn languages through music',
        theme_color: '#0d0404',
        background_color: '#0d0404',
        display: 'standalone',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  optimizeDeps: {
    // The auto-align workers (whisper/demucs) import these heavy deps, which
    // aren't reachable from the initial module graph. Without pre-declaring
    // them, Vite discovers them at runtime when auto-align starts, re-optimizes,
    // and forces a full page reload. Pre-bundling them up front avoids that.
    include: ['@xenova/transformers', 'onnxruntime-web'],
    // kuromoji/zlibjs are pre-bundled by esbuild; patch zlibjs there.
    esbuildOptions: {
      plugins: [zlibjsThisShim],
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
