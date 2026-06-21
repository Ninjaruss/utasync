import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WHISPER_STATIC_FILES,
  buildModelFileUrl,
  prefetchWhisperModelFiles,
  whisperPrefetchPaths,
} from '../../src/ai-pipeline/modelPrefetch'

describe('whisperPrefetchPaths', () => {
  it('keeps tokenizer sidecars and the two quantized ONNX blobs only', () => {
    const paths = whisperPrefetchPaths([
      'config.json',
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
      'README.md',
    ])
    expect(paths).toEqual([
      'config.json',
      'onnx/decoder_model_merged_quantized.onnx',
      'onnx/encoder_model_quantized.onnx',
    ])
  })
})

describe('buildModelFileUrl', () => {
  it('builds a huggingface resolve URL', () => {
    expect(buildModelFileUrl('Xenova/whisper-tiny', 'config.json')).toBe(
      'https://huggingface.co/Xenova/whisper-tiny/resolve/main/config.json',
    )
  })
})

describe('prefetchWhisperModelFiles', () => {
  const put = vi.fn()
  const match = vi.fn()

  beforeEach(() => {
    put.mockReset()
    match.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({ match, put }),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/models/')) {
          return new Response(
            JSON.stringify(
              WHISPER_STATIC_FILES.map((path) => ({ type: 'file', path, size: path.endsWith('.onnx') ? 1000 : 10 })),
            ),
            { status: 200 },
          )
        }
        const size = url.includes('.onnx') ? 1000 : 10
        return new Response(new Uint8Array(size), {
          status: 200,
          headers: { 'Content-Length': String(size) },
        })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads missing files into transformers-cache', async () => {
    const progress: string[] = []
    const result = await prefetchWhisperModelFiles('Xenova/whisper-tiny', (p) => progress.push(p.file))
    expect(progress.length).toBeGreaterThan(0)
    expect(put).toHaveBeenCalled()
    expect(result.host).toBe('https://huggingface.co/')
  })

  it('reports the mirror host when the primary host fails for every file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/models/')) {
          return new Response(
            JSON.stringify(
              WHISPER_STATIC_FILES.map((path) => ({ type: 'file', path, size: path.endsWith('.onnx') ? 1000 : 10 })),
            ),
            { status: 200 },
          )
        }
        if (url.startsWith('https://huggingface.co/')) {
          // Non-retryable so the (8-attempt, backed-off) retry loop in
          // downloadToArrayBuffer doesn't slow this test down.
          return new Response(null, { status: 404 })
        }
        const size = url.includes('.onnx') ? 1000 : 10
        return new Response(new Uint8Array(size), {
          status: 200,
          headers: { 'Content-Length': String(size) },
        })
      }),
    )
    const result = await prefetchWhisperModelFiles('Xenova/whisper-tiny')
    expect(result.host).toBe('https://hf.co/')
  })

  it('skips network when a complete cached entry exists', async () => {
    match.mockImplementation(async (url: string) => {
      if (url.includes('config.json')) {
        return new Response(new Uint8Array(10), { status: 200 })
      }
      return undefined
    })
    const fetchSpy = vi.mocked(fetch)
    const callsBefore = fetchSpy.mock.calls.length
    await prefetchWhisperModelFiles('Xenova/whisper-tiny')
    const configFetches = fetchSpy.mock.calls
      .slice(callsBefore)
      .filter(([url]) => String(url).includes('config.json'))
    expect(configFetches).toHaveLength(0)
  })
})
