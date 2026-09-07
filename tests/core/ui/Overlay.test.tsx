import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Overlay } from '../../../src/core/ui/Overlay'
import { resetScrollLock } from '../../../src/core/ui/scrollLock'

afterEach(() => {
  resetScrollLock()
  document.body.style.overflow = ''
})

describe('Overlay', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} label="Test"><button>inside</button></Overlay>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the panel on open', () => {
    render(<Overlay onClose={vi.fn()} label="Test"><button>inside</button></Overlay>)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'inside' }))
  })

  it('restores focus to the opener on unmount', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<Overlay onClose={vi.fn()} label="Test"><button>inside</button></Overlay>)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('locks background scroll for a sheet and releases it on unmount', () => {
    const { unmount } = render(<Overlay onClose={vi.fn()} label="Test"><button>inside</button></Overlay>)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('does not lock scroll for an anchored menu', () => {
    render(
      <Overlay onClose={vi.fn()} placement="anchored" role="menu" label="Menu">
        <button>item</button>
      </Overlay>,
    )
    expect(document.body.style.overflow).toBe('')
  })

  it('closes an anchored menu on an outside pointerdown', () => {
    const onClose = vi.fn()
    render(
      <Overlay onClose={onClose} placement="anchored" role="menu" label="Menu">
        <button>item</button>
      </Overlay>,
    )
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close a sheet on an outside pointerdown', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} label="Test"><button>inside</button></Overlay>)
    fireEvent.pointerDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('carries the accessible role and name onto the panel', () => {
    render(<Overlay onClose={vi.fn()} role="alertdialog" label="Discard?"><button>ok</button></Overlay>)
    const panel = screen.getByRole('alertdialog', { name: 'Discard?' })
    expect(panel.getAttribute('aria-modal')).toBe('true')
  })

  it('closes on the browser Back gesture for a sheet', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} label="Test"><button>inside</button></Overlay>)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onClose).toHaveBeenCalled()
  })
})
