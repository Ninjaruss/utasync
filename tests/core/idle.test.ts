import { describe, it, expect, vi, afterEach } from 'vitest'
import { runWhenIdle } from '../../src/core/idle'

describe('runWhenIdle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    runWhenIdle(fn, 1000)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('cancels scheduled work', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const cancel = runWhenIdle(fn, 1000)
    cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
