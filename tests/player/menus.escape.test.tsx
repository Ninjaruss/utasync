import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DisplayMenu } from '../../src/player/DisplayMenu'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

/** jsdom reports no matchMedia match by default, but the hook falls back to
 * `true` (desktop) when matchMedia is missing — so without this every DisplayMenu
 * test silently exercised only the desktop panel. The mobile panel is portaled
 * and positioned a tick later, which is where Escape was actually broken. */
function setViewport(kind: 'mobile' | 'desktop') {
  const isDesktop = kind === 'desktop'
  window.matchMedia = ((query: string) => ({
    matches: isDesktop && query.includes('768px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const originalMatchMedia = window.matchMedia
afterEach(() => { window.matchMedia = originalMatchMedia })

const lines: TimedLine[] = [{ startTime: 0, endTime: 2, original: 'a', translation: 'A' }]

describe.each(['desktop', 'mobile'] as const)('Display menu dismissal (%s)', (viewport) => {
  beforeEach(() => setViewport(viewport))

  /** `focusTrigger` mirrors the keyboard path (Tab to the button, then activate):
   * jsdom's click does not focus, so without it there is no opener to restore to. */
  const open = (focusTrigger = false) => {
    render(
      <DisplayMenu
        isJapanese
        hasTranslation
        furiganaMode="furigana"
        showTranslation
        lyricsLayout="stacked"
        onFuriganaCycle={vi.fn()}
        onToggleTranslation={vi.fn()}
        onToggleLayout={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('button', { name: /lyrics display options/i })
    if (focusTrigger) trigger.focus()
    fireEvent.click(trigger)
    return trigger
  }

  it('closes on Escape', async () => {
    open()
    await waitFor(() => expect(screen.getByRole('dialog', { name: /lyrics display options/i })).toBeTruthy())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /lyrics display options/i })).toBeNull())
  })

  it('returns focus to the Display button when it closes', async () => {
    const trigger = open(true)
    await waitFor(() => expect(screen.getByRole('dialog', { name: /lyrics display options/i })).toBeTruthy())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('can scroll rather than drawing its lower rows off a landscape screen', async () => {
    open()
    const panel = await screen.findByRole('dialog', { name: /lyrics display options/i })
    expect(panel.className).toMatch(/overflow-y-auto/)
    expect(panel.className).toMatch(/max-h-/)
  })
})

describe('Edit mode More menu dismissal', () => {
  it('closes on Escape', async () => {
    render(
      <EditMode
        lines={lines}
        playhead={() => 0}
        hasLocalAudio
        onChangeLines={vi.fn()}
        onAutoAlign={vi.fn()}
        title="t"
        artist="a"
        sourceLanguage="ja"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^more$/i }))
    await waitFor(() => expect(screen.getByRole('menu', { name: /more lyric actions/i })).toBeTruthy())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: /more lyric actions/i })).toBeNull())
  })
})
