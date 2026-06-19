import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DisplayMenu } from '../../src/player/DisplayMenu'

const baseProps = {
  isJapanese: true,
  hasTranslation: true,
  furiganaMode: 'furigana' as const,
  showTranslation: true,
  lyricsLayout: 'stacked' as const,
  onFuriganaCycle: vi.fn(),
  onToggleTranslation: vi.fn(),
  onToggleLayout: vi.fn(),
}

describe('DisplayMenu', () => {
  it('opens a dialog with grouped sections', () => {
    render(<DisplayMenu {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
    expect(screen.getByRole('dialog', { name: /lyrics display options/i })).toBeTruthy()
    expect(screen.getByText('Reading')).toBeTruthy()
    expect(screen.getByText('Translation')).toBeTruthy()
  })

  it('highlights the trigger when display settings differ from defaults', () => {
    const { container } = render(
      <DisplayMenu {...baseProps} furiganaMode="romaji" />,
    )
    const btn = container.querySelector('button[aria-haspopup="dialog"]')!
    expect(btn.className).toMatch(/cinnabar-accent/)
  })
})
