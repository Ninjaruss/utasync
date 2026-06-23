import { defineConfig } from 'vitest/config'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

// @xenova/transformers is tested against onnxruntime-web 1.14.0, but this repo
// also depends on onnxruntime-web 1.26 for demucs. npm hoists 1.26, which breaks
// Whisper model loading with a misleading "Unsupported model type: whisper".
const ORT_WASM_DIR = fileURLToPath(
  new URL('node_modules/@xenova/transformers/dist/', import.meta.url),
)

function serveOnnxWasmFile(
  req: Connect.IncomingMessage,
  res: import('node:http').ServerResponse,
  next: Connect.NextFunction,
) {
  const url = req.url?.split('?')[0]
  if (!url?.startsWith('/onnx-wasm/') || !url.endsWith('.wasm')) {
    next()
    return
  }
  const name = url.slice('/onnx-wasm/'.length)
  if (name.includes('..') || name.includes('/')) {
    next()
    return
  }
  try {
    const data = readFileSync(join(ORT_WASM_DIR, name))
    res.setHeader('Content-Type', 'application/wasm')
    res.setHeader('Content-Length', String(data.length))
    res.end(data)
  } catch {
    next()
  }
}

/** Serve ONNX Runtime WASM from @xenova/transformers locally (avoids CDN stream drops). */
const serveOnnxWasm: Plugin = {
  name: 'serve-onnx-wasm',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(serveOnnxWasmFile)
  },
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use(serveOnnxWasmFile)
  },
  generateBundle() {
    for (const name of readdirSync(ORT_WASM_DIR)) {
      if (!name.endsWith('.wasm')) continue
      this.emitFile({
        type: 'asset',
        fileName: `onnx-wasm/${name}`,
        source: readFileSync(join(ORT_WASM_DIR, name)),
      })
    }
  },
}

const ORT_FOR_TRANSFORMERS = fileURLToPath(
  new URL(
    'node_modules/@xenova/transformers/node_modules/onnxruntime-web/dist/ort-web.min.js',
    import.meta.url,
  ),
)

function usesTransformersOnnx(importer: string | undefined): boolean {
  if (!importer) return false
  const path = importer.replace(/\\/g, '/')
  return (
    path.includes('@xenova/transformers')
    || path.includes('/ai-pipeline/whisper')
    || path.includes('/ai-pipeline/whisperPipeline')
  )
}

/** Route transformers.js to its compatible onnxruntime-web build. */
const onnxRuntimeForTransformers: Plugin = {
  name: 'onnxruntime-for-transformers',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source !== 'onnxruntime-web') return null
    if (!usesTransformersOnnx(importer)) return null
    return ORT_FOR_TRANSFORMERS
  },
}

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
    onnxRuntimeForTransformers,
    serveOnnxWasm,
    serveRawDict,
    kuromojiRollupShim,
    react(),
    VitePWA({
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,wasm}'],
        // ONNX Runtime wasm blobs are 9–26 MB and only needed when AI features
        // run, so keep them out of the precache (Workbox caps precache entries at
        // 2 MiB) and cache them at runtime on first use instead.
        globIgnores: ['**/ort-wasm*.wasm'],
        runtimeCaching: [
          {
            urlPattern: /\/models\/.*\.onnx$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ai-models-v1',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          // ONNX wasm is served from /onnx-wasm/ on the same origin — do not
          // CacheFirst it here; a truncated SW entry causes "Content-Length
          // header exceeds response Body" when ORT loads the wasm.
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
    include: ['@xenova/transformers'],
    esbuildOptions: {
      alias: {
        'onnxruntime-web': ORT_FOR_TRANSFORMERS,
      },
      plugins: [kuromojiEsbuildShim],
    },
  },
  build: {
    target: 'esnext',
  },
  worker: { format: 'es' },
  // Dev/preview only — lets you test the Whisper WASM multi-threading speedup
  // (src/ai-pipeline/whisperPipeline.ts gates on `crossOriginIsolated`, which
  // these headers enable) and verify YouTube playback still works before
  // deciding whether to add the same headers on your production host. Not
  // applied to the production build itself; static hosts need their own
  // header config (see docs/DEPLOYMENT.md) to get the speedup in production.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
