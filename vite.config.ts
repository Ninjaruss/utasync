import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { Connect, PreviewServer, ViteDevServer } from 'vite'

// ---------------------------------------------------------------------------
// kuromoji source patches
//
// kuromoji's dictionary loaders don't work unmodified in a browser bundle:
//   1. DictionaryLoader does `var path = require("path")` then `path.join(...)`,
//      but Vite/esbuild leave the Node `path` builtin unimplemented, so
//      `path.join` is undefined and the loader throws.
//   2. BrowserDictionaryLoader gunzips the dictionary with zlibjs, which stalls
//      in this bundle. The browser's native DecompressionStream handles the same
//      files reliably and fast, so we swap it in. We also make it tolerant of a
//      server that already decompressed the .gz (via Content-Encoding: gzip): if
//      the bytes aren't gzip-framed, use them as-is. This keeps dict loading
//      correct regardless of how the host serves the files.
//
// These run as source-content rewrites so they apply both in dev (esbuild
// pre-bundle) and in production (Rollup) — see the plugins wired below.
// ---------------------------------------------------------------------------

const inlinePathSrc =
  'var path = { join: function () { return Array.prototype.slice.call(arguments)' +
  '.filter(Boolean).join("/").replace(/\\/{2,}/g, "/"); } };'

function patchDictionaryLoader(code: string): string {
  return code.replace(/var path = require\(["']path["']\);/, inlinePathSrc)
}

const nativeGunzipSrc = [
  'var __u8 = new Uint8Array(arraybuffer);',
  '        if (__u8.length > 1 && __u8[0] === 0x1f && __u8[1] === 0x8b) {',
  '          new Response(new Blob([arraybuffer]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()',
  '            .then(function (b) { callback(null, b); })',
  '            .catch(function (e) { callback(e, null); });',
  '        } else {',
  '          callback(null, arraybuffer);', // server already decompressed it
  '        }',
].join('\n')

function patchBrowserDictionaryLoader(code: string): string {
  return code
    // Drop the zlibjs dependency entirely — DecompressionStream replaces it.
    .replace(/var zlib = require\(["']zlibjs[^"']*["']\);/, 'var zlib = null;')
    .replace(
      /var gz = new zlib\.Zlib\.Gunzip\(new Uint8Array\(arraybuffer\)\);\s*var typed_array = gz\.decompress\(\);\s*callback\(null, typed_array\.buffer\);/,
      nativeGunzipSrc,
    )
}

const DICT_LOADER_RE = /kuromoji[\\/]src[\\/]loader[\\/]DictionaryLoader\.js$/
const BROWSER_LOADER_RE = /kuromoji[\\/]src[\\/]loader[\\/]BrowserDictionaryLoader\.js$/

// Dev: esbuild dep pre-bundle. Patches the source as it's loaded.
const kuromojiEsbuildShim = {
  name: 'kuromoji-esbuild-shim',
  setup(build: { onLoad: (opts: { filter: RegExp }, cb: (args: { path: string }) => { contents: string; loader: 'js' }) => void }) {
    build.onLoad({ filter: DICT_LOADER_RE }, (args) => ({
      contents: patchDictionaryLoader(readFileSync(args.path, 'utf8')),
      loader: 'js',
    }))
    build.onLoad({ filter: BROWSER_LOADER_RE }, (args) => ({
      contents: patchBrowserDictionaryLoader(readFileSync(args.path, 'utf8')),
      loader: 'js',
    }))
  },
}

// Production: Rollup build. Same patches via a transform hook so the built app
// works too (esbuild dep optimization does not run for `vite build`).
const kuromojiRollupShim = {
  name: 'kuromoji-rollup-shim',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    const path = id.split('?')[0]
    if (DICT_LOADER_RE.test(path)) return { code: patchDictionaryLoader(code), map: null }
    if (BROWSER_LOADER_RE.test(path)) return { code: patchBrowserDictionaryLoader(code), map: null }
    return null
  },
}

// The kuromoji dictionary lives in public/dict as pre-gzipped .dat.gz files,
// meant to reach the client as raw gzip bytes. A static server that treats a
// `.gz` file as pre-compressed sets `Content-Encoding: gzip`, so the browser
// silently decompresses it. Serve these as raw octet-streams with no encoding
// in dev and preview so the bytes reach the (DecompressionStream) loader intact.
// (Production hosts vary, which is why the loader above also tolerates the
// already-decompressed case.)
function serveDictRaw(req: Connect.IncomingMessage, res: import('node:http').ServerResponse, next: Connect.NextFunction) {
  const url = req.url?.split('?')[0]
  if (url && url.startsWith('/dict/') && url.endsWith('.gz')) {
    try {
      const filePath = fileURLToPath(new URL(`./public${url}`, import.meta.url))
      const data = readFileSync(filePath)
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', String(data.length))
      res.end(data)
      return
    } catch {
      // fall through to default handling if the file is missing
    }
  }
  next()
}

const serveRawDict = {
  name: 'serve-raw-dict',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(serveDictRaw)
  },
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use(serveDictRaw)
  },
}

export default defineConfig({
  plugins: [
    serveRawDict,
    kuromojiRollupShim,
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
    // kuromoji is pre-bundled by esbuild in dev; patch its loaders there.
    esbuildOptions: {
      plugins: [kuromojiEsbuildShim],
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
