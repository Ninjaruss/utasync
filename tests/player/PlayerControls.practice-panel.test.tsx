import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { usePlayerStore } from '../../src/player/PlayerStore'
import { PlayerControls } from '../../src/player/PlayerControls'

const baseProps = {
  mode: 'play' as const,
  playbackState: 'paused' as const,
  position: 0,
  duration: 120,
  progress: 0,
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

describe('SavedLoopsPanelSection toggle', () => {
  it('shows Open when collapsed and Close when expanded', () => {
    usePlayerStore.setState({
      abLoop: { a: null, b: null, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 },
    })
    render(<PlayerControls {...baseProps} />)

    const toggle = screen.getByRole('button', { name: /open saved loops/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Open')).toBeTruthy()

    fireEvent.click(toggle)
    const closeToggle = screen.getByRole('button', { name: /close saved loops/i })
    expect(closeToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Close')).toBeTruthy()
    expect(document.getElementById('saved-loops-panel-content')).toBeTruthy()

    fireEvent.click(closeToggle)
    expect(screen.getByRole('button', { name: /open saved loops/i })).toHaveAttribute('aria-expanded', 'false')
  })
})
