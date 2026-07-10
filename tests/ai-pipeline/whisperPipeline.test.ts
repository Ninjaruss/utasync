import { describe, it, expect, vi } from 'vitest'

vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } }, allowLocalModels: false, useBrowserCache: false },
  pipeline: vi.fn(async () => ({ mock: true })),
}))

import { loadWhisperAsrPipeline } from '../../src/ai-pipeline/whisperPipeline'
import { pipeline } from '@huggingface/transformers'

describe('loadWhisperAsrPipeline', () => {
  it('passes device + dtype to the v3 pipeline', async () => {
    await loadWhisperAsrPipeline('Xenova/whisper-small', { device: 'webgpu', dtype: 'fp16' })
    expect(pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      'Xenova/whisper-small',
      expect.objectContaining({ device: 'webgpu', dtype: 'fp16' }),
    )
  })
})
