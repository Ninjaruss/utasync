import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { useHistoryDismiss } from '../../../src/core/ui/useHistoryDismiss'

import { StrictMode } from 'react'

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

  it('does not grow history when the same sheet is opened repeatedly', async () => {
    const onDismiss = vi.fn()
    const { rerender, unmount } = render(<Sheet onDismiss={onDismiss} />)
    const depth = window.history.length

    // Close with the ✕, reopen, close, reopen — the parked entry is reused.
    for (let i = 0; i < 3; i++) {
      rerender(<Sheet onDismiss={onDismiss} open={false} />)
      rerender(<Sheet onDismiss={onDismiss} open />)
    }
    expect(window.history.length).toBe(depth)
    expect(onDismiss).not.toHaveBeenCalled()
    unmount()
  })

  // Regression: StrictMode runs effects mount → cleanup → mount. The cleanup's
  // own history.back() then arrived at the SECOND instance's listener, which
  // read it as a user Back and dismissed the sheet the instant it opened — the
  // Add-song sheet became impossible to open in dev.
  it('survives StrictMode double-invoking the effect', async () => {
    const onDismiss = vi.fn()
    render(
      <StrictMode>
        <Sheet onDismiss={onDismiss} />
      </StrictMode>,
    )
    await new Promise((r) => setTimeout(r, 30))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('still dismisses on a real Back after a StrictMode remount', async () => {
    const onDismiss = vi.fn()
    render(
      <StrictMode>
        <Sheet onDismiss={onDismiss} />
      </StrictMode>,
    )
    await new Promise((r) => setTimeout(r, 30))

    await goBack()
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1))
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
