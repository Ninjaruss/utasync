import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

  it('shows a hint row instead of hiding the Translation section when no translation is attached', () => {
    render(<DisplayMenu {...baseProps} hasTranslation={false} />)
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
    expect(screen.getByText('Translation')).toBeTruthy()
    expect(screen.getByText(/no translation attached — add one in edit mode/i)).toBeTruthy()
    // The interactive controls stay hidden — there is nothing to toggle yet.
    expect(screen.queryByRole('checkbox', { name: /show translation/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /side by side/i })).toBeNull()
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

  // Fix 1(b)/(c) of the final review pass: the shared OVERLAY_SURFACES contract
  // (tests/core/ui/overlaySurfaces.tsx, row 21 and row 21 mobile) checks the
  // generic close-on-Escape/focus-trap/accessible-name contract every migrated
  // surface shares, but two DisplayMenu-specific assertions from the retired
  // tests/player/menus.escape.test.tsx had no replacement. Both are surface
  // specifics that don't belong in the shared table, so they live here instead.
  describe('closing returns focus to its own trigger', () => {
    it('returns focus to the Display button on Escape', async () => {
      render(<DisplayMenu {...baseProps} />)
      const trigger = screen.getByRole('button', { name: /lyrics display options/i })
      trigger.focus()
      fireEvent.click(trigger)
      await waitFor(() => expect(screen.getByRole('dialog', { name: /lyrics display options/i })).toBeTruthy())

      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(document.activeElement).toBe(trigger))
    })
  })

  describe('the mobile panel scrolls rather than drawing its lower rows off-screen', () => {
    const originalMatchMedia = window.matchMedia
    afterEach(() => { window.matchMedia = originalMatchMedia })
    function stubMobileViewport() {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia
    }

    it('caps panel height with max-h- and lets it overflow-y-auto', async () => {
      stubMobileViewport()
      render(<DisplayMenu {...baseProps} />)
      fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
      const panel = await screen.findByRole('dialog', { name: /lyrics display options/i })
      // Guards the fix at src/player/DisplayMenu.tsx:353-355: in landscape the
      // panel starts ~155px down a 375px viewport, so lower rows (Side by side,
      // Match song phrasing) were previously drawn off the bottom edge with no
      // way to reach them.
      expect(panel.className).toMatch(/max-h-/)
      expect(panel.className).toMatch(/overflow-y-auto/)
    })
  })

  // Fix 5 of the final review pass: four trigger buttons across the app
  // (src/player/DisplayMenu.tsx:315, src/lyrics/EditMode.tsx:642, and two in
  // src/player/PlayerControls.tsx) call e.stopPropagation() on onPointerDown
  // so that clicking the trigger to close an open menu doesn't immediately
  // reopen it — useOutsideDismiss listens for pointerdown on `document` in the
  // bubble phase, and without stopPropagation that listener would fire first
  // (closing the menu), before the trigger's own onClick toggle runs
  // afterwards and flips the now-closed state back open. fireEvent.click does
  // NOT fire pointerdown, so no test using only fireEvent.click would ever
  // catch a regression here. DisplayMenu is picked as the one representative
  // site: it's the simplest of the four to render standalone (no PlayerControls
  // or EditMode scaffolding required) and this file already holds its other
  // trigger/panel-specific assertions.
  it('clicking the trigger to close an open menu closes it rather than reopening it', async () => {
    render(<DisplayMenu {...baseProps} />)
    const trigger = screen.getByRole('button', { name: /lyrics display options/i })

    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('dialog', { name: /lyrics display options/i })).toBeTruthy())

    // Mirrors the real browser sequence a click produces: pointerdown fires
    // first (and bubbles to document, where useOutsideDismiss listens),
    // then click fires the trigger's own onClick toggle.
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /lyrics display options/i })).toBeNull())
  })
})
