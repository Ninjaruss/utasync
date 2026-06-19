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
})
