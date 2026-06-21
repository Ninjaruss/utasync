import { describe, it, expect, vi } from 'vitest'
import {
  friendlyModelLoadError,
  isRetryableNetworkError,
  withNetworkRetry,
} from '../../src/ai-pipeline/networkErrors'

describe('networkErrors', () => {
  it('detects Firefox mid-stream fetch failures', () => {
    expect(isRetryableNetworkError(new Error('Error in input stream'))).toBe(true)
    expect(isRetryableNetworkError(new Error('network error'))).toBe(true)
    expect(isRetryableNetworkError(new Error('Content-Length header of network response exceeds response Body.'))).toBe(true)
    expect(isRetryableNetworkError(new Error('Unsupported model type: whisper'))).toBe(false)
  })

  it('maps interrupted downloads to actionable guidance', () => {
    const err = friendlyModelLoadError(new Error('Error in input stream'))
    expect(err.message).toMatch(/interrupted/i)
    expect(err.message).toMatch(/Try again/i)
  })

  it('maps corrupt cache entries to actionable guidance', () => {
    const err = friendlyModelLoadError(new Error('Content-Length header of network response exceeds response Body.'))
    expect(err.message).toMatch(/incomplete/i)
  })

  it('retries retryable errors then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Error in input stream'))
      .mockResolvedValue('ok')
    await expect(withNetworkRetry(fn, 3, 1)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
