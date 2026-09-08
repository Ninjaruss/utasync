import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { Overlay } from '../../../src/core/ui/Overlay'
import { ConfirmDialog } from '../../../src/core/ui/ConfirmDialog'
import { resetScrollLock } from '../../../src/core/ui/scrollLock'

afterEach(() => {
  resetScrollLock()
  document.body.style.overflow = ''
})

describe('a confirm stacked over a sheet', () => {
  it('gives Escape to the confirm, not the sheet underneath', () => {
    const closeSheet = vi.fn()
    const cancelConfirm = vi.fn()
    render(
      <Overlay onClose={closeSheet} label="Sheet">
        <button type="button">sheet control</button>
        <ConfirmDialog title="Discard?" message="Lost." onConfirm={() => {}} onCancel={cancelConfirm} />
      </Overlay>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancelConfirm).toHaveBeenCalledTimes(1)
    expect(closeSheet).not.toHaveBeenCalled()
  })

  it('keeps the page locked when the inner overlay unmounts, and unlocks only when the outer one does', () => {
    // ConfirmDialog uses placement="contained", which never acquires a scroll
    // lock (Overlay only locks for "sheet"/"fullscreen"). A confirm nested
    // inside a sheet therefore never touches the refcount, so asserting the
    // lock survives its unmount proves nothing about reference counting — the
    // outer sheet's own lock was the only one ever held. Nest a second
    // placement="sheet" overlay instead so both genuinely acquire a lock.
    function Stacked({ showInner }: { showInner: boolean }) {
      return (
        <Overlay onClose={vi.fn()} label="Outer sheet">
          <button type="button">outer control</button>
          {showInner && (
            <Overlay onClose={vi.fn()} label="Inner sheet" placement="sheet">
              <button type="button">inner control</button>
            </Overlay>
          )}
        </Overlay>
      )
    }

    const { rerender, unmount } = render(<Stacked showInner />)
    expect(document.body.style.overflow).toBe('hidden')

    rerender(<Stacked showInner={false} />)
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
