import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InlineError } from '../../../src/core/ui/InlineError'

describe('InlineError', () => {
  it('renders its message inside a role=alert region', () => {
    render(<InlineError>Something went wrong</InlineError>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
  })

  it('renders an aria-hidden warning glyph before the message', () => {
    const { container } = render(<InlineError>Heads up</InlineError>)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    // Glyph draws with the current text colour so it reads as part of the error.
    expect(svg?.getAttribute('stroke')).toBe('currentColor')
  })

  it('applies an optional className alongside the base treatment', () => {
    render(<InlineError className="shrink-0">Oops</InlineError>)
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('shrink-0')
    // Keeps the filled error treatment (not bare accent text).
    expect(alert.className).toContain('bg-red-900/90')
  })
})
