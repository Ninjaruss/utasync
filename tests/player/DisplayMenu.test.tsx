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

  // The drill blanks tokens, so on a song whose lyrics have no word data the
  // toggle was enabled, checkable, and did nothing at all — the menu showed
  // "Hide words to recall" checked and highlighted while the lyric column showed
  // nothing to drill. Rows without tokens are normal: enrichment is background
  // work that can fail or be skipped (gated on word alignment being available).
  it('explains an unavailable recall drill instead of offering a dead toggle', () => {
    render(<DisplayMenu {...baseProps} clozeAvailable={false} onToggleCloze={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))

    const toggle = screen.getByRole('checkbox', { name: /hide words to recall/i }) as HTMLInputElement
    expect(toggle.disabled).toBe(true)
    expect(screen.getByText(/needs word data for this song/i)).toBeTruthy()
    expect(screen.queryByText(/blanks out content words/i)).toBeNull()
  })

  it('keeps the drill offered, and its difficulty picker visible, when word data exists', () => {
    render(<DisplayMenu {...baseProps} clozeMode clozeDifficulty="easy" clozeAvailable onToggleCloze={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))

    expect((screen.getByRole('checkbox', { name: /hide words to recall/i }) as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByRole('group', { name: 'Difficulty' })).toBeTruthy()
    expect(screen.getByText(/blanks out content words/i)).toBeTruthy()
  })

  // Verified live in Firefox: with nothing playing, NO row is active (the active
  // row renders at text-xl, both rows were 16px), so switching the drill on showed
  // no blanks and no Reveal button with nothing explaining why. The hint now says
  // the dependency out loud.
  it('says the drill follows playback, so a paused player does not look broken', () => {
    render(<DisplayMenu {...baseProps} clozeAvailable onToggleCloze={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
    expect(screen.getByText(/press play first/i)).toBeTruthy()
  })

  // The reading cycle is the one control whose entire visible label on a phone is
  // the current mode's name, so the hint naming the other two states was missing
  // exactly where it was most needed.
  it('names the furigana cycle in the compact (mobile) panel too', () => {
    const originalMatchMedia = window.matchMedia
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
    try {
      render(<DisplayMenu {...baseProps} />)
      fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
      expect(screen.getByText(/Tap to cycle: Off → Romaji → Furigana/i)).toBeTruthy()
    } finally {
      window.matchMedia = originalMatchMedia
    }
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

    // …but a max-height alone did not fix it: the panel starts BELOW the trigger,
    // so "70dvh of panel" can still end below the fold, and content past the
    // panel's own bottom edge is unreachable — its scroll area stops there. The
    // position now comes from the measured height, which this pins down.
    it('raises the panel so its bottom edge stays on screen', async () => {
      stubMobileViewport()
      // Landscape-ish phone: trigger ~155px down a 375px-tall viewport, panel
      // measuring 70dvh = 262px. Unclamped, the panel ran to 155+6+262 = 423px.
      const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
      const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        top: 130, bottom: 155, left: 200, right: 320,
        width: 120, height: 25, x: 200, y: 130,
        toJSON: () => ({}),
      } as DOMRect)
      const innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight')
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 375 })
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 262 })

      try {
        render(<DisplayMenu {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /lyrics display options/i }))
        const panel = await screen.findByRole('dialog', { name: /lyrics display options/i })

        // 375 - 262 - 8 = 105px, i.e. bottom edge at 367px: on screen.
        expect(panel.style.top).toBe('105px')
        expect(155 + 6 + 262).toBeGreaterThan(375) // the unclamped case this guards
      } finally {
        rectSpy.mockRestore()
        if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor)
        if (innerHeightDescriptor) Object.defineProperty(window, 'innerHeight', innerHeightDescriptor)
      }
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
