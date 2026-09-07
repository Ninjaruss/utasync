import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlockingOverlay } from '../../../src/core/ui/BlockingOverlay'
import { resetScrollLock } from '../../../src/core/ui/scrollLock'

afterEach(() => {
  resetScrollLock()
  document.body.style.overflow = ''
})

describe('BlockingOverlay', () => {
  it('announces itself as a busy status, not a dialog', () => {
    const { unmount } = render(<BlockingOverlay label="Loading models">…</BlockingOverlay>)
    const el = screen.getByRole('status', { name: 'Loading models' })
    expect(el.getAttribute('aria-live')).toBe('polite')
    expect(el.getAttribute('aria-busy')).toBe('true')
    unmount()
  })

  it('is not exposed as a dialog, because it traps no focus and has no exit', () => {
    const { unmount } = render(<BlockingOverlay label="Loading models">…</BlockingOverlay>)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    unmount()
  })

  it('locks background scroll while it is up', () => {
    const { unmount } = render(<BlockingOverlay label="Loading models">…</BlockingOverlay>)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
