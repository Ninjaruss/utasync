import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlayerControls } from '../../src/player/PlayerControls'

// The export menu closes itself in the same click that starts the export, so the
// failure message has to live outside the popover. It used to be rendered only
// inside the panel, which the click had just unmounted: a failed A/B export was
// indistinguishable from a successful one — no file, no message, nothing.
//
// jsdom reports desktop for useMinWidthMd (no matchMedia), which is the layout
// where the menu is reachable from the toolbar.

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
  abLoop: { a: 10, b: 20 },
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

describe('A-B export failure reporting', () => {
  it('keeps the failure visible after the click that closes the export menu', () => {
    render(
      <PlayerControls
        {...baseProps}
        showAbExport
        onExportAb={vi.fn()}
        abExportError="Could not export this loop. The audio file is missing."
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'More playback options' }))
    const menu = screen.getByRole('dialog', { name: 'More playback options' })
    expect(menu).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /export a-b loop/i }))

    // The menu is gone…
    expect(screen.queryByRole('dialog', { name: 'More playback options' })).toBeNull()
    // …and the message the user needs in order to recover is still on screen.
    expect(screen.getByRole('alert')).toHaveTextContent('Could not export this loop')
  })

  it('shows nothing when the export has not failed', () => {
    render(<PlayerControls {...baseProps} showAbExport onExportAb={vi.fn()} abExportError={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'More playback options' }))
    fireEvent.click(screen.getByRole('button', { name: /export a-b loop/i }))

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
