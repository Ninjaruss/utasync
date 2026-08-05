import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { useHistoryDismiss } from '../../../src/core/ui/useHistoryDismiss'

function Sheet({ onDismiss, open = true }: { onDismiss: () => void; open?: boolean }) {
  useHistoryDismiss(onDismiss, open)
  return <div>sheet</div>
}

/** jsdom's history.back() resolves on a task, so every Back is awaited. */
const goBack = async () => {
  await act(async () => {
    window.history.back()
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(async () => {
  // Reset to a single known entry so depth assertions are meaningful.
  window.history.replaceState(null, '', '/')
})

describe('useHistoryDismiss', () => {
  it('routes the system Back gesture into dismissal instead of leaving the page', async () => {
    const onDismiss = vi.fn()
    render(<Sheet onDismiss={onDismiss} />)

    await goBack()
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1))
  })

  it('does not consume Back when it is not enabled', async () => {
    const onDismiss = vi.fn()
    render(<Sheet onDismiss={onDismiss} open={false} />)

    await goBack()
    await new Promise((r) => setTimeout(r, 10))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('leaves the entry it added behind when closed some other way', async () => {
    const onDismiss = vi.fn()
    const { unmount, rerender } = render(<Sheet onDismiss={onDismiss} />)
    const depthWithSheet = window.history.length

    // Closed with the ✕ rather than Back.
    rerender(<Sheet onDismiss={onDismiss} open={false} />)
    await waitFor(() => expect(window.history.length).toBeLessThanOrEqual(depthWithSheet))
    // Popping our own entry must not read as a user Back gesture.
    expect(onDismiss).not.toHaveBeenCalled()
    unmount()
  })

  it('reads the latest callback, so an inline arrow does not re-arm the entry', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Sheet onDismiss={first} />)
    rerender(<Sheet onDismiss={second} />)

    await goBack()
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1))
    expect(first).not.toHaveBeenCalled()
  })
})
