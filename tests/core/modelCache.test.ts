import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clearAiModelCache, AI_MODEL_CACHE_NAMES } from '../../src/core/storage/modelCache'

describe('clearAiModelCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('clears both ONNX and Transformers.js cache buckets', async () => {
    const deleteMock = vi.fn().mockResolvedValue(true)
    const keysMock = vi.fn().mockResolvedValue([{ url: '/a' }, { url: '/b' }])
    const openMock = vi.fn().mockResolvedValue({ keys: keysMock, delete: deleteMock })

    vi.stubGlobal('caches', { open: openMock })

    const deleted = await clearAiModelCache()

    expect(openMock).toHaveBeenCalledTimes(AI_MODEL_CACHE_NAMES.length)
    expect(AI_MODEL_CACHE_NAMES.every((name) => openMock.mock.calls.some((c) => c[0] === name))).toBe(true)
    expect(deleted).toBe(AI_MODEL_CACHE_NAMES.length * 2)
  })
})
