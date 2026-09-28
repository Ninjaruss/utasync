import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } }, allowLocalModels: false, useBrowserCache: false },
  pipeline: vi.fn(async () => ({ mock: true })),
}))

vi.mock('../../src/core/storage/modelCache', () => ({
  purgeCorruptModelCaches: vi.fn(async () => 0),
  clearWhisperModelCache: vi.fn(async () => 0),
}))

import { loadWhisperAsrPipeline } from '../../src/ai-pipeline/whisperPipeline'
import { pipeline } from '@huggingface/transformers'
import { purgeCorruptModelCaches, clearWhisperModelCache } from '../../src/core/storage/modelCache'

/** jsdom reports onLine: true; the offline branch of the purge decision needs it false. */
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

describe('loadWhisperAsrPipeline', () => {
  afterEach(() => {
    setOnline(true)
    vi.mocked(purgeCorruptModelCaches).mockClear()
    vi.mocked(clearWhisperModelCache).mockClear()
    vi.mocked(pipeline).mockReset()
    vi.mocked(pipeline).mockResolvedValue({ mock: true } as never)
  })

  it('passes device + dtype to the v3 pipeline', async () => {
    await loadWhisperAsrPipeline('Xenova/whisper-small', { device: 'webgpu', dtype: 'fp16' })
    expect(pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-small',
      expect.objectContaining({ device: 'webgpu', dtype: 'fp16' }),
    )
  })

  it('discards the damaged model files when the cached bytes are corrupt', async () => {
    vi.mocked(pipeline).mockRejectedValue(
      new Error('Content-Length header of network response exceeds response Body.'),
    )
    await expect(
      loadWhisperAsrPipeline('Xenova/whisper-small', { device: 'wasm', dtype: 'q8' }),
    ).rejects.toThrow(/incomplete/i)
    expect(purgeCorruptModelCaches).toHaveBeenCalled()
    expect(clearWhisperModelCache).toHaveBeenCalledWith('Xenova/whisper-small')
  })

  it('keeps the cached model when the failure is just being offline', async () => {
    setOnline(false)
    vi.mocked(pipeline).mockRejectedValue(new Error('boom'))
    await expect(
      loadWhisperAsrPipeline('Xenova/whisper-small', { device: 'wasm', dtype: 'q8' }),
    ).rejects.toThrow(/offline/i)
    // The ~240 MB of cached weights are not implicated by a missing network.
    expect(purgeCorruptModelCaches).not.toHaveBeenCalled()
    expect(clearWhisperModelCache).not.toHaveBeenCalled()
  })

  it('drops only provably-truncated entries on an unclassified failure', async () => {
    vi.mocked(pipeline).mockRejectedValue(new Error('boom'))
    await expect(
      loadWhisperAsrPipeline('Xenova/whisper-small', { device: 'wasm', dtype: 'q8' }),
    ).rejects.toThrow(/boom/)
    expect(purgeCorruptModelCaches).toHaveBeenCalled()
    expect(clearWhisperModelCache).not.toHaveBeenCalled()
  })
})
