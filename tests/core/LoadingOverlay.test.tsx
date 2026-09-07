import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingOverlay } from '../../src/core/ui/LoadingOverlay'

describe('LoadingOverlay', () => {
  it('shows a spinner, message, and optional detail', () => {
    render(<LoadingOverlay message="Saving audio…" detail="Copying file to local storage" />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Saving audio…')).toBeTruthy()
    expect(screen.getByText('Copying file to local storage')).toBeTruthy()
  })

  it('does not duplicate the message as both aria-label and visible text', () => {
    render(<LoadingOverlay message="Saving audio…" />)
    const statusEl = screen.getByRole('status')
    // The outer status region should use aria-labelledby to reference the visible message,
    // not aria-label, to avoid screen readers announcing the message twice
    expect(statusEl.getAttribute('aria-labelledby')).toBe('loading-overlay-message')
    // aria-label should not be present when aria-labelledby is used
    expect(statusEl.getAttribute('aria-label')).toBeNull()
    // The visible message should still be there
    expect(screen.getByText('Saving audio…')).toBeTruthy()
  })
})
