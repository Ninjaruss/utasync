import { describe, it, expect, vi } from 'vitest'
import { useRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { useModalDialog } from '../../../src/core/ui/useModalDialog'

/** Minimal host that uses the hook the way every real modal in the app does. */
function Modal({ onClose, enabled = true }: { onClose: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalDialog(ref, onClose, enabled)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Test dialog" tabIndex={-1}>
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    </div>
  )
}

function Harness({ onClose, open, enabled }: { onClose: () => void; open: boolean; enabled?: boolean }) {
  return (
    <>
      <button type="button">opener</button>
      {open && <Modal onClose={onClose} enabled={enabled} />}
    </>
  )
}

describe('useModalDialog', () => {
  it('moves focus into the dialog on open', () => {
    render(<Harness onClose={vi.fn()} open />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }))
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} open />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('wraps Tab from the last focusable back to the first', () => {
    render(<Harness onClose={vi.fn()} open />)
    const last = screen.getByRole('button', { name: 'last' })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }))
  })

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    render(<Harness onClose={vi.fn()} open />)
    const first = screen.getByRole('button', { name: 'first' })
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }))
  })

  it('pulls focus back in when it escapes to the page behind', () => {
    render(<Harness onClose={vi.fn()} open />)
    const opener = screen.getByRole('button', { name: 'opener' })
    opener.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('restores focus to the element that opened it', () => {
    const { rerender } = render(<Harness onClose={vi.fn()} open={false} />)
    const opener = screen.getByRole('button', { name: 'opener' })
    opener.focus()
    rerender(<Harness onClose={vi.fn()} open />)
    expect(document.activeElement).not.toBe(opener)
    rerender(<Harness onClose={vi.fn()} open={false} />)
    expect(document.activeElement).toBe(opener)
  })

  it('does nothing while disabled', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    render(<Harness onClose={onClose} open enabled={false} />)
    expect(document.activeElement).toBe(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    opener.remove()
  })

  it('only the innermost dialog reacts to Escape, so a confirm does not close its parent', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    function Nested() {
      const outerRef = useRef<HTMLDivElement>(null)
      const innerRef = useRef<HTMLDivElement>(null)
      useModalDialog(outerRef, outer)
      useModalDialog(innerRef, inner)
      return (
        <div ref={outerRef} role="dialog" aria-label="outer" tabIndex={-1}>
          <button type="button">outer button</button>
          <div ref={innerRef} role="alertdialog" aria-label="inner" tabIndex={-1}>
            <button type="button">inner button</button>
          </div>
        </div>
      )
    }
    render(<Nested />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })
})
