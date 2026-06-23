import { withNetworkRetry } from './networkErrors'
import { TRANSFORMERS_CACHE_NAME } from '../core/storage/modelCache'

export const HF_HOSTS = ['https://huggingface.co/', 'https://hf.co/'] as const

/** JSON / tokenizer sidecars + the two quantized ONNX blobs Whisper needs. */
export function whisperPrefetchPaths(paths: string[]): string[] {
  const out: string[] = []
  for (const path of paths) {
    if (path.startsWith('onnx/')) {
      if (
        path === 'onnx/encoder_model_quantized.onnx'
        || path === 'onnx/decoder_model_merged_quantized.onnx'
      ) {
        out.push(path)
      }
      continue
    }
    if (path.startsWith('.') || path === 'README.md') continue
    if (/\.(json|txt)$/i.test(path)) out.push(path)
  }
  return out.sort()
}

/** Static fallback when the Hugging Face file-list API is unreachable. */
export const WHISPER_STATIC_FILES = [
  'added_tokens.json',
  'config.json',
  'generation_config.json',
  'merges.txt',
  'normalizer.json',
  'preprocessor_config.json',
  'quant_config.json',
  'quantize_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
] as const

export interface ModelFileDescriptor {
  path: string
  size: number
}

export interface PrefetchProgress {
  file: string
  filesCompleted: number
  filesTotal: number
  aggregateProgress: number
}

export function buildModelFileUrl(
  modelId: string,
  filename: string,
  host: (typeof HF_HOSTS)[number] = HF_HOSTS[0],
  revision = 'main',
): string {
  const base = host.replace(/\/$/, '')
  const encodedRev = encodeURIComponent(revision)
  return `${base}/${modelId}/resolve/${encodedRev}/${filename}`
}

export async function listRemoteModelFiles(modelId: string): Promise<ModelFileDescriptor[]> {
  const apiUrl = `https://huggingface.co/api/models/${modelId}/tree/main?recursive=true`
  try {
    const res = await fetch(apiUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const entries = (await res.json()) as { type?: string; path?: string; size?: number }[]
    return entries
      .filter((e) => e.type === 'file' && e.path)
      .map((e) => ({ path: e.path!, size: e.size ?? 0 }))
  } catch {
    return WHISPER_STATIC_FILES.map((path) => ({ path, size: 0 }))
  }
}

async function openTransformersCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  try {
    return await caches.open(TRANSFORMERS_CACHE_NAME)
  } catch {
    return null
  }
}

async function cachedEntryComplete(
  cache: Cache,
  url: string,
  expectedSize: number,
): Promise<boolean> {
  const hit = await cache.match(url)
  if (!hit) return false

  const declared = parseInt(hit.headers.get('Content-Length') ?? '', 10)
  if (!Number.isNaN(declared) && declared > 0) {
    if (expectedSize > 0) {
      if (declared === expectedSize) return true
    } else {
      // HF listing unavailable — trust a non-zero Content-Length without reading ~240MB blobs.
      return true
    }
  }

  const blob = await hit.blob()
  if (blob.size === 0) {
    await cache.delete(url)
    return false
  }
  if (!Number.isNaN(declared) && declared > 0 && blob.size !== declared) {
    await cache.delete(url)
    return false
  }
  if (expectedSize > 0 && blob.size !== expectedSize) {
    await cache.delete(url)
    return false
  }
  return true
}

async function downloadToArrayBuffer(url: string): Promise<ArrayBuffer> {
  return withNetworkRetry(
    async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return res.arrayBuffer()
    },
    8,
    1500,
  )
}

async function storeInCache(cache: Cache, url: string, buffer: ArrayBuffer): Promise<void> {
  try {
    await cache.put(
      url,
      new Response(buffer, {
        headers: { 'Content-Length': String(buffer.byteLength) },
      }),
    )
  } catch (err) {
    console.warn('Unable to persist model file to browser cache:', err)
  }
}

export interface PrefetchResult {
  /** Host that actually served (or already cached) the files — feed into `env.remoteHost`
   *  before calling `from_pretrained`, otherwise it always reads from HF_HOSTS[0] and a
   *  fallback-host download becomes a permanent cache miss there. */
  host: string
}

/**
 * Downloads Whisper model files with fetch().arrayBuffer() (not transformers.js'
 * streaming reader, which is where "Error in input stream" usually comes from),
 * then stores them in the transformers-cache bucket so from_pretrained hits cache.
 */
export async function prefetchWhisperModelFiles(
  modelId: string,
  onProgress?: (p: PrefetchProgress) => void,
): Promise<PrefetchResult> {
  const listed = await listRemoteModelFiles(modelId)
  const files = whisperPrefetchPaths(listed.map((f) => f.path))
  const sizeByPath = new Map(listed.map((f) => [f.path, f.size]))
  const cache = await openTransformersCache()
  const total = files.length
  let completed = 0
  let resolvedHost: string = HF_HOSTS[0]

  for (const file of files) {
    const expectedSize = sizeByPath.get(file) ?? 0
    let fetched = false

    for (const host of HF_HOSTS) {
      const url = buildModelFileUrl(modelId, file, host)
      if (cache && (await cachedEntryComplete(cache, url, expectedSize))) {
        fetched = true
        resolvedHost = host
        break
      }

      try {
        const buffer = await downloadToArrayBuffer(url)
        if (expectedSize > 0 && buffer.byteLength !== expectedSize) {
          throw new Error(`Incomplete download for ${file}`)
        }
        if (cache) await storeInCache(cache, url, buffer)
        fetched = true
        resolvedHost = host
        break
      } catch (err) {
        if (host === HF_HOSTS[HF_HOSTS.length - 1]) throw err
      }
    }

    if (!fetched) throw new Error(`Could not download ${file}`)

    completed++
    onProgress?.({
      file,
      filesCompleted: completed,
      filesTotal: total,
      aggregateProgress: Math.round((completed / total) * 100),
    })
  }

  return { host: resolvedHost }
}
