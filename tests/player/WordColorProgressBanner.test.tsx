import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WordColorProgressBanner } from '../../src/player/WordColorProgressBanner'

describe('WordColorProgressBanner', () => {
  it('shows progress count and percentage', () => {
    render(<WordColorProgressBanner done={3} total={12} />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Coloring word pairs, 3 of 12')
    expect(screen.getByText('Coloring word pairs… 3/12')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
  })
})
