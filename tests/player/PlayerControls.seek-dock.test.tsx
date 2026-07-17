import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('SeekBar accessibility', () => {
  it('exposes slider semantics with an mm:ss value text', () => {
    render(<PlayerControls {...baseProps} />)
    const slider = screen.getByRole('slider', { name: 'Seek' })
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '120')
    expect(slider).toHaveAttribute('aria-valuenow', '65')
    expect(slider).toHaveAttribute('aria-valuetext', '1:05')
    expect(slider).toHaveAttribute('tabindex', '0')
  })

  it('seeks 5 seconds with arrow keys', () => {
    const onSeek = vi.fn()
    render(<PlayerControls {...baseProps} onSeek={onSeek} />)
    const slider = screen.getByRole('slider', { name: 'Seek' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onSeek).toHaveBeenLastCalledWith(70)
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(onSeek).toHaveBeenLastCalledWith(60)
  })

  it('clamps keyboard seeks to the track bounds', () => {
    const onSeek = vi.fn()
    render(<PlayerControls {...baseProps} position={1} progress={1 / 120} onSeek={onSeek} />)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Seek' }), { key: 'ArrowLeft' })
    expect(onSeek).toHaveBeenLastCalledWith(0)
  })
})

describe('player dock height CSS variable', () => {
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

  it('publishes the dock height on mobile and removes it on unmount', () => {
    const heightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(280)
    try {
      const { unmount } = render(<PlayerControls {...baseProps} />)
      expect(document.documentElement.style.getPropertyValue('--player-dock-height')).toBe('280px')
      unmount()
      expect(document.documentElement.style.getPropertyValue('--player-dock-height')).toBe('')
    } finally {
      heightSpy.mockRestore()
    }
  })
})
