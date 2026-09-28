import { defineConfig } from 'vitest/config'
import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

// @huggingface/transformers bundles its own onnxruntime-web build (currently
// 1.22.0-dev), distinct from the onnxruntime-web 1.26 this repo also depends on
// for demucs. npm keeps @huggingface/transformers' copy nested, so we serve its
// wasm straight out of its own dist/ dir rather than the hoisted top-level one —
// mixing versions breaks Whisper model loading with a misleading "Unsupported
// model type: whisper".
const ORT_WASM_DIR = fileURLToPath(
  new URL('node_modules/@huggingface/transformers/dist/', import.meta.url),
)

// The demucs worker uses the top-level onnxruntime-web (1.26), a DIFFERENT build
// from the one transformers bundles. Its jsep runtime (.wasm + dynamically-
// imported .mjs) must be served from our own origin too — without this the
// worker's ORT tries a CDN/relative path that 404s in production, so vocal
// separation fails and alignment silently falls back to the raw mix. Served
// under a distinct prefix so the two ORT versions never get mixed.
const DEMUCS_ORT_DIR = fileURLToPath(
  new URL('node_modules/onnxruntime-web/dist/', import.meta.url),
)

// Prefix → source dir for the two ORT runtimes we serve locally.
const ORT_SERVE_DIRS: Record<string, string> = {
  '/onnx-wasm/': ORT_WASM_DIR,
  '/onnx-wasm-demucs/': DEMUCS_ORT_DIR,
}

function serveOnnxWasmFile(
  req: Connect.IncomingMessage,
  res: import('node:http').ServerResponse,
  next: Connect.NextFunction,
) {
  const url = req.url?.split('?')[0]
  // Serve the ORT wasm binary AND its jsep glue module: the WebGPU backend
  // dynamically imports `ort-wasm-simd-threaded.jsep.mjs`, so serving only .wasm
  // breaks WebGPU with "error loading dynamically imported module".
  const prefix = url ? Object.keys(ORT_SERVE_DIRS).find((p) => url.startsWith(p)) : undefined
  if (!prefix || !(url!.endsWith('.wasm') || url!.endsWith('.mjs'))) {
    next()
    return
  }
  const name = url!.slice(prefix.length)
  if (name.includes('..') || name.includes('/')) {
    next()
    return
  }
  try {
    const data = readFileSync(join(ORT_SERVE_DIRS[prefix], name))
    res.setHeader('Content-Type', name.endsWith('.mjs') ? 'text/javascript' : 'application/wasm')
    res.setHeader('Content-Length', String(data.length))
    res.end(data)
  } catch {
    next()
  }
}

/** ORT runtime files that must be served from /onnx-wasm/: the wasm binary and
 * the jsep glue module the WebGPU backend imports. Excludes the node-only
 * transformers.node.*.mjs bundles that also live in the dist dir. */
function isOrtRuntimeAsset(name: string): boolean {
  return name.startsWith('ort-wasm') && (name.endsWith('.wasm') || name.endsWith('.mjs'))
}

/** Serve ONNX Runtime WASM from @huggingface/transformers locally (avoids CDN stream drops). */
const serveOnnxWasm: Plugin = {
  name: 'serve-onnx-wasm',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(serveOnnxWasmFile)
  },
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use(serveOnnxWasmFile)
  },
  generateBundle() {
    for (const [prefix, dir] of Object.entries(ORT_SERVE_DIRS)) {
      const folder = prefix.slice(1) // '/onnx-wasm/' → 'onnx-wasm/'
      for (const name of readdirSync(dir)) {
        if (!isOrtRuntimeAsset(name)) continue
        this.emitFile({
          type: 'asset',
          fileName: `${folder}${name}`,
          source: readFileSync(join(dir, name)),
        })
      }
    }
  },
}

const ORT_FOR_TRANSFORMERS = fileURLToPath(
  new URL(
    'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort.bundle.min.mjs',
    import.meta.url,
  ),
)

function usesTransformersOnnx(importer: string | undefined): boolean {
  if (!importer) return false
  const path = importer.replace(/\\/g, '/')
  return (
    path.includes('@huggingface/transformers')
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

const LEGAL_PAGE_PATHS: Record<string, string> = {
  '/privacy': 'privacy/index.html',
  '/privacy/': 'privacy/index.html',
  '/terms': 'terms/index.html',
  '/terms/': 'terms/index.html',
}

function serveLegalPages(
  req: Connect.IncomingMessage,
  res: import('node:http').ServerResponse,
  next: Connect.NextFunction,
) {
  const url = req.url?.split('?')[0]
  const rel = url ? LEGAL_PAGE_PATHS[url] : undefined
  if (!rel) {
    next()
    return
  }
  try {
    const filePath = fileURLToPath(new URL(`./public/${rel}`, import.meta.url))
    const data = readFileSync(filePath, 'utf8')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(data)
  } catch {
    next()
  }
}

const serveLegal = {
  name: 'serve-legal-pages',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(serveLegalPages)
  },
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use(serveLegalPages)
  },
}

// Dev-only status sink for the self-driving E2E align harness
// (src/dev/e2eAlignHarness.ts). The harness runs in browsers no automation can
// reach (real Firefox), so it POSTs progress + its final report here; they land
// in node_modules/.e2e-status.log for whoever launched the run to tail.
function e2eStatusSink(
  req: Connect.IncomingMessage,
  res: import('node:http').ServerResponse,
  next: Connect.NextFunction,
) {
  if (req.url?.split('?')[0] !== '/__e2e-status' || req.method !== 'POST') {
    next()
    return
  }
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    try {
      const line = `${new Date().toISOString()} ${Buffer.concat(chunks).toString('utf8')}\n`
      appendFileSync(fileURLToPath(new URL('node_modules/.e2e-status.log', import.meta.url)), line)
    } catch {
      // best-effort sink; never fail the request
    }
    res.statusCode = 204
    res.end()
  })
}

const e2eStatus = {
  name: 'e2e-status-sink',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(e2eStatusSink)
  },
}

export default defineConfig({
  define: {
    // Captured once per build (once per dev-server start), so the date shown in
    // Settings identifies the version being viewed rather than the moment
    // someone happened to open Settings. Read via `appBuildTime()`.
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    onnxRuntimeForTransformers,
    serveOnnxWasm,
    serveRawDict,
    serveLegal,
    e2eStatus,
    kuromojiRollupShim,
    react(),
    VitePWA({
      // Auto-apply SW updates so users drop stale precache (old builds pinned COEP on index.html).
      registerType: 'autoUpdate',
      workbox: {
        cacheId: 'utasync-v3-no-coep',
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Precache the document itself. It used to be excluded (together with
        // `navigateFallback: null` below) because a cached index.html carried the
        // COEP headers of the build that created it, which broke YouTube on
        // Firefox/Zen. That reason no longer applies and is handled elsewhere:
        // the cacheId is v3 (the COEP-era caches were `utasync-v2-no-coep`),
        // src/core/pwa/purgeStaleCoepCaches.ts deletes the pre-v3 `utasync-*`
        // caches, and cleanupOutdatedCaches() drops precaches from older Workbox
        // versions. v3 itself has never precached an html document, so no stale
        // header-pinned copy exists to inherit — while excluding it left the
        // service worker unable to answer ANY document request, so a cold start
        // with no network fell through to the browser's offline page.
        // If the host ever goes back behind COEP, bump the cacheId (and the purge
        // flag in purgeStaleCoepCaches.ts) instead of re-excluding index.html.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,wasm}'],
        // ONNX wasm blobs are 14–26 MB and only needed when AI features run, so keep
        // them out of the precache (Workbox's 2 MiB precache cap); the runtime route
        // below caches them on first use instead.
        globIgnores: ['**/ort-wasm*.wasm'],
        // Serve the precached shell for every navigation, which is what makes a cold
        // start with no network open the app at all. Freshness online still holds:
        // the precache entry for index.html is content-hashed (__WB_REVISION__), so
        // any deploy that changes the document installs a new revision, and
        // registerType 'autoUpdate' + skipWaiting/clientsClaim apply it on the next
        // load. The legal pages are denied: they are separate documents, and letting
        // the fallback answer /privacy or /terms would render the app instead of the
        // policy the link promises. (Their precached copies still answer /privacy/
        // offline, because the precache route is registered before this fallback.)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/privacy/, /^\/terms/],
        runtimeCaching: [
          {
            // Same-origin model copy (the default /models/Kim_Vocal_2.onnx, ~66 MB).
            // CacheFirst, not StaleWhileRevalidate: SWR re-downloaded the whole
            // 66.8 MB binary in the background on every single run — on metered
            // mobile data too — to revalidate a URL that never changes.
            // Invalidation: entries expire after 30 days; Settings → Clear AI model
            // cache clears this bucket (`ai-models-v1` is one of the names in
            // src/core/storage/modelCache.ts). To replace a shipped model binary
            // sooner, bump that cache name in BOTH files.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname.startsWith('/models/') && url.pathname.endsWith('.onnx'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ai-models-v1',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // A remote VITE_DEMUCS_MODEL_URL (cross-origin, CORS-enabled host).
            // StaleWhileRevalidate, not CacheFirst: the URL is unversioned, so
            // CacheFirst would serve a redeployed model binary forever (opaque
            // cross-origin responses never read a Date header, so the freshness
            // check treats them as fresh indefinitely). Revalidating in the
            // background lets a redeployed model win on the next load while still
            // loading instantly (and offline) from cache. The same-origin route
            // above matches first, so this only ever handles the remote case.
            urlPattern: /\.onnx(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'ai-models-v1',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The ONNX Runtime the models run ON, served from our own origin:
            // /onnx-wasm/ (the build @huggingface/transformers bundles, used by the
            // whisper path) and /onnx-wasm-demucs/ (onnxruntime-web 1.26, used by the
            // demucs worker). Neither was cached by anything, so an offline
            // auto-align could never succeed even with every model weight cached —
            // the runtime fetch, not the model, was the thing that failed.
            // Cached on first use rather than precached (21–26 MB per .wasm), and
            // reused offline afterwards. `onnx-runtime-v1` is one of the buckets
            // src/core/storage/modelCache.ts already reports and clears, and
            // purgeCorruptModelCaches() (called when a model load fails) deletes any
            // entry whose body is shorter than its Content-Length — the truncated
            // cached response that surfaces as "Content-Length header exceeds
            // response Body" when ORT loads it, which is why CacheFirst was
            // previously avoided here.
            urlPattern: /\/onnx-wasm(?:-demucs)?\/ort-wasm[^/?]*\.(?:wasm|mjs)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'onnx-runtime-v1',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Dictionary and linguistic data: JMdict gloss/popover/readings,
            // CMUdict, and kuromoji's own dictionaries. All fetched same-origin
            // (/jmdict-gloss.json, /jmdict-popover.json, /jmdict-readings.json,
            // /cmudict.json, /dict/*.dat.gz), none matched a precache glob — they
            // are 3.8–29.8 MB each, i.e. ~53 MB that must never be an install cost —
            // and none matched a runtime route, so offline they simply failed:
            // tokenization, romaji, ruby and tap-lookup degraded silently while the
            // offline banner promised they worked. CacheFirst after first use, so
            // they work offline from then on. Workbox's
            // maximumFileSizeToCacheInBytes does not apply here: it caps precache
            // manifest entries, and these are runtime-cached, never precached.
            // Bump `linguistic-assets-v1` when shipping new dictionary data (the
            // same manual convention as cacheId) — the URL does not change.
            urlPattern:
              /\/(?:jmdict-(?:gloss|popover|readings)|cmudict)\.json(?:\?.*)?$|\/dict\/[^/?]+\.dat\.gz(?:\?.*)?$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'linguistic-assets-v1',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
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
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  optimizeDeps: {
    // The auto-align workers (whisper/demucs) import these heavy deps, which
    // aren't reachable from the initial module graph. Without pre-declaring
    // them, Vite discovers them at runtime when auto-align starts, re-optimizes,
    // and forces a full page reload. Pre-bundling them up front avoids that.
    include: ['@huggingface/transformers'],
    esbuildOptions: {
      alias: {
        'onnxruntime-web': ORT_FOR_TRANSFORMERS,
      },
      plugins: [kuromojiEsbuildShim],
    },
  },
  build: {
    // Pinned, not 'esnext'. With esnext nothing is downlevelled, so the real
    // minimum browser is whatever the emitted syntax happens to demand — a
    // number nobody had measured and no check enforced, which drifts upward
    // silently every time a dependency adopts newer syntax. The failure mode is
    // a parse error and a blank page, not degraded behaviour.
    //
    // These versions are MEASURED, not guessed: `node scripts/bundle-syntax-floor.mjs`
    // (after a build) reports what the output actually requires. Re-run it after
    // dependency bumps; if the floor rises above these, that is a deliberate
    // support decision to make, not a silent regression.
    //
    // Deliberately NOT set lower. build.target downlevels SYNTAX only — it never
    // polyfills runtime APIs, and the transformers worker bundles call
    // structuredClone / Object.hasOwn (Safari 15.4). Targeting anything older
    // would produce a bundle that parses and then throws, which is a worse
    // promise than not supporting the browser at all.
    target: ['chrome98', 'edge98', 'firefox94', 'safari15.4'],
  },
  worker: { format: 'es' },
  // Explicitly disable cross-origin isolation so YouTube embeds work in Firefox/Zen.
  // (credentialless COEP breaks them with NS_ERROR_DOM_COEP_FAILED.)
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
      'Cross-Origin-Opener-Policy': 'unsafe-none',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
      'Cross-Origin-Opener-Policy': 'unsafe-none',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    /* Must stay comfortably above the `asyncUtilTimeout` set in test-setup.ts.
     * With vitest's 5s default, a test whose own waitFor budget was 5s (or the
     * 10s some files asked for) died on the vitest timer before its own grace
     * period was up — so the failure blamed the test's duration rather than the
     * assertion, and raising the waitFor budget in a file did nothing. */
    testTimeout: 20_000,
  },
})
