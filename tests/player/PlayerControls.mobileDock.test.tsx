import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PlayerControls } from '../../src/player/PlayerControls'

const baseProps = {
  mode: 'play' as const,
  playbackState: 'paused' as const,
  position: 65,
  duration: 120,
  progress: 65 / 120,
  speed: 1,
  speedPct: 100,
  volume: 0.75,
  volumePct: 75,
  onSpeedChange: () => {},
  onVolumeChange: () => {},
  abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 },
  armingAB: null,
  abLoopError: null,
  onTogglePlay: () => {},
  onSeek: () => {},
  onToggleArm: () => {},
  onClearAB: () => {},
  playlistEntries: [],
  playlistActive: false,
  playlistIndex: 0,
  playlistRepeatCount: 3,
  canSaveToPlaylist: false,
}

describe('mobile play-mode control dock', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    // Force the mobile branch: useMinWidthMd reports desktop when matchMedia
    // is unavailable (as in jsdom), so stub it to report a narrow viewport.
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
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    vi.unstubAllGlobals()
    document.documentElement.style.removeProperty('--player-dock-height')
  })

  it('renders a Loop / Speed / Saved chip row with 44px chips', () => {
    render(<PlayerControls {...baseProps} />)
    const chipRow = screen.getByRole('group', { name: /playback shortcuts/i })
    const loop = within(chipRow).getByRole('button', { name: 'Loop' })
    const speed = within(chipRow).getByRole('button', { name: /speed/i })
    const saved = within(chipRow).getByRole('button', { name: 'Saved loops' })
    expect(loop).toHaveClass('min-h-11')
    expect(speed).toHaveClass('min-h-11')
    expect(saved).toHaveClass('min-h-11')
  })

  it('shows the current speed percent on the Speed chip', () => {
    render(<PlayerControls {...baseProps} speed={0.75} speedPct={75} />)
    const chipRow = screen.getByRole('group', { name: /playback shortcuts/i })
    expect(within(chipRow).getByText(/75%/)).toBeTruthy()
  })

  it('keeps the AB loop controls and the volume slider out of the DOM until a chip opens the drawer', () => {
    render(<PlayerControls {...baseProps} />)
    // Nothing from the drawer is mounted while it is closed.
    expect(screen.queryByRole('region', { name: /a-b loop/i })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Volume' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Loop' }))

    expect(screen.getByRole('region', { name: /a-b loop/i })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy()
    // Tapping the Loop chip lands the loop section EXPANDED (arm controls
    // visible) even with no A/B set yet — no extra tap to reveal them.
    expect(screen.getByRole('button', { name: /A loop point/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /B loop point/i })).toBeTruthy()
  })

  it('closes the drawer from the ✕ button', () => {
    render(<PlayerControls {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /speed/i }))
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close controls' }))
    expect(screen.queryByRole('slider', { name: 'Volume' })).toBeNull()
  })

  it('closes the drawer from the backdrop', () => {
    render(<PlayerControls {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Saved loops' }))
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('slider', { name: 'Volume' })).toBeNull()
  })

  it('marks the Loop chip active when an AB point is set', () => {
    render(<PlayerControls {...baseProps} abLoop={{ ...baseProps.abLoop, a: 30 }} />)
    expect(screen.getByTestId('loop-active-dot')).toBeTruthy()
  })

  it('shows no Loop active-dot when no AB point is set', () => {
    render(<PlayerControls {...baseProps} />)
    expect(screen.queryByTestId('loop-active-dot')).toBeNull()
  })
})

describe('desktop play-mode control dock stays inline', () => {
  it('renders the sections inline with no chip row', () => {
    // jsdom has no matchMedia, so useMinWidthMd reports desktop by default.
    render(<PlayerControls {...baseProps} />)
    // No mobile chip row / Loop chip.
    expect(screen.queryByRole('group', { name: /playback shortcuts/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Loop' })).toBeNull()
    // The inline A-B section and the always-visible volume slider still render.
    expect(screen.getByRole('region', { name: /a-b loop/i })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy()
  })
})
