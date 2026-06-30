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

  it('omits the phrasing section when no regroupings are available', () => {
    render(<DisplayMenu {...baseProps} phrasingAvailable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
    expect(screen.queryByText('Phrasing')).toBeNull()
    expect(screen.queryByText(/match song phrasing/i)).toBeNull()
  })

  it('shows a self-explaining phrasing toggle when regroupings exist', () => {
    render(<DisplayMenu {...baseProps} phrasingAvailable onTogglePhrasing={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
    expect(screen.getByText('Phrasing')).toBeTruthy()
    expect(screen.getByText(/match song phrasing/i)).toBeTruthy()
    // Self-explaining copy so a new user understands what it does.
    expect(screen.getByText(/how the song is actually sung/i)).toBeTruthy()
  })

  it('toggles phrasing when the control is clicked', () => {
    const onTogglePhrasing = vi.fn()
    render(<DisplayMenu {...baseProps} phrasingAvailable onTogglePhrasing={onTogglePhrasing} />)
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /match song phrasing/i }))
    expect(onTogglePhrasing).toHaveBeenCalledOnce()
  })

  it('reflects the active sung layout as checked and in the summary', () => {
    render(
      <DisplayMenu {...baseProps} phrasingAvailable sungLayoutActive onTogglePhrasing={vi.fn()} />,
    )
    const trigger = screen.getByRole('button', { name: /lyrics display options/i })
    expect(trigger.textContent).toMatch(/sung phrasing/i)
    fireEvent.click(trigger)
    expect((screen.getByRole('checkbox', { name: /match song phrasing/i }) as HTMLInputElement).checked).toBe(true)
  })

  it('disables the phrasing control while busy', () => {
    render(
      <DisplayMenu {...baseProps} phrasingAvailable phrasingBusy onTogglePhrasing={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
    expect((screen.getByRole('checkbox', { name: /match song phrasing/i }) as HTMLInputElement).disabled).toBe(true)
  })
})
