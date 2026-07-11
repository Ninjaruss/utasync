import { describe, it, expect, vi } from 'vitest'

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

describe('loadWhisperAsrPipeline', () => {
  it('passes device + dtype to the v3 pipeline', async () => {
    await loadWhisperAsrPipeline('Xenova/whisper-small', { device: 'webgpu', dtype: 'fp16' })
    expect(pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-small',
      expect.objectContaining({ device: 'webgpu', dtype: 'fp16' }),
    )
  })

  it('purges the corrupt model cache when the load ultimately fails', async () => {
    vi.mocked(pipeline).mockRejectedValueOnce(new Error('boom'))
    await expect(
      loadWhisperAsrPipeline('Xenova/whisper-small', { device: 'wasm', dtype: 'q8' }),
    ).rejects.toThrow()
    expect(purgeCorruptModelCaches).toHaveBeenCalled()
    expect(clearWhisperModelCache).toHaveBeenCalledWith('Xenova/whisper-small')
  })
})
