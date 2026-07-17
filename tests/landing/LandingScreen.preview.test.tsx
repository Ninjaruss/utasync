import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LandingScreen } from '../../src/landing/LandingScreen'

describe('LandingScreen in-app preview mock', () => {
  it('renders the illustrative synced-line preview with furigana and colour-paired glosses', () => {
    const { container } = render(<LandingScreen onOpenApp={vi.fn()} />)

    // Subtle "Preview" label marks it as an illustration.
    expect(screen.getByText('Preview')).toBeTruthy()

    // Real HTML ruby furigana — one <ruby> + <rt> per content word.
    const readings = Array.from(container.querySelectorAll('ruby rt')).map((n) => n.textContent)
    expect(readings).toEqual(['きょう', 'ゆき', 'ふ'])

    // Colour-matched English gloss chips beneath the line.
    expect(screen.getByText('today')).toBeTruthy()
    expect(screen.getByText('snow')).toBeTruthy()
    expect(screen.getByText('falls')).toBeTruthy()

    // Decorative: the whole mock is hidden from the accessibility tree.
    const rubyEl = container.querySelector('ruby')
    expect(rubyEl?.closest('[aria-hidden="true"]')).toBeTruthy()
  })
})
