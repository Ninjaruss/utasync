import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
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

  it('keeps the page locked when the inner confirm unmounts', () => {
    const { rerender } = render(
      <Overlay onClose={vi.fn()} label="Sheet">
        <button type="button">sheet control</button>
        <ConfirmDialog title="Discard?" message="Lost." onConfirm={() => {}} onCancel={vi.fn()} />
      </Overlay>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(
      <Overlay onClose={vi.fn()} label="Sheet">
        <button type="button">sheet control</button>
      </Overlay>,
    )
    expect(document.body.style.overflow).toBe('hidden')
  })
})
