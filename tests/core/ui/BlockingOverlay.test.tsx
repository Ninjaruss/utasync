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

  it('can suppress live-region announcement with announce=false', () => {
    const { unmount } = render(
      <BlockingOverlay label="Loading models" announce={false}>
        …
      </BlockingOverlay>,
    )
    // When announce={false}, the root should not be a status region
    expect(screen.queryByRole('status')).toBeNull()
    // Instead, it should be presentation (inert for a11y)
    const el = document.querySelector('[role="presentation"]')
    expect(el).toBeTruthy()
    expect(el?.getAttribute('aria-live')).toBeNull()
    expect(el?.getAttribute('aria-busy')).toBeNull()
    expect(el?.getAttribute('aria-label')).toBeNull()
    unmount()
  })

  it('can use aria-labelledby to reference visible content', () => {
    const { unmount } = render(
      <BlockingOverlay label="Loading models" aria-labelledby="my-label">
        <p id="my-label">Visible message</p>
      </BlockingOverlay>,
    )
    const el = screen.getByRole('status')
    expect(el.getAttribute('aria-labelledby')).toBe('my-label')
    // When aria-labelledby is present, aria-label should not be used
    expect(el.getAttribute('aria-label')).toBeNull()
    unmount()
  })
})
