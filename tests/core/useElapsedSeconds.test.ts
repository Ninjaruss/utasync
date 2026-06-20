import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useElapsedSeconds } from '../../src/core/ui/useElapsedSeconds'

describe('useElapsedSeconds', () => {
  it('resets when inactive and counts whole seconds while active', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ active }) => useElapsedSeconds(active),
      { initialProps: { active: true } },
    )

    expect(result.current).toBe(0)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe(1)

    rerender({ active: false })
    expect(result.current).toBe(0)

    vi.useRealTimers()
  })
})
