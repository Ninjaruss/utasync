import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TapSyncEditor } from '../../src/player/TapSyncEditor'

function renderEditor(overrides: Partial<Parameters<typeof TapSyncEditor>[0]> = {}) {
  const onComplete = vi.fn()
  const onTogglePlay = vi.fn()
  const onSeek = vi.fn()
  const onVolumeChange = vi.fn()
  const onSpeedChange = vi.fn()
  render(
    <TapSyncEditor
      plainLines={['line one']}
      translations={['']}
      audioPosition={() => 1.5}
      onComplete={onComplete}
      onCancel={vi.fn()}
      isPlaying={false}
      onTogglePlay={onTogglePlay}
      onSeek={onSeek}
      volume={1}
      onVolumeChange={onVolumeChange}
      speed={1}
      onSpeedChange={onSpeedChange}
      {...overrides}
    />,
  )
  return { onComplete, onTogglePlay, onSeek, onVolumeChange, onSpeedChange }
}

describe('TapSyncEditor', () => {
  it('explains the flow, labels the tap button, and finishes with "Save timing"', () => {
    const { onComplete } = renderEditor()

    expect(screen.getByText(/press play, then tap the moment each line starts/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Mark line start' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save timing' }))
    expect(onComplete).toHaveBeenCalledWith([
      { startTime: 1.5, endTime: 6.5, original: 'line one', translation: '' },
    ])
  })

  it('drives playback from the transport controls', () => {
    const { onTogglePlay, onSeek } = renderEditor({ isPlaying: false })
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(onTogglePlay).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /back 3 seconds/i }))
    expect(onSeek).toHaveBeenCalled()
  })

  it('shows a Pause affordance while playing', () => {
    renderEditor({ isPlaying: true })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    expect(screen.getByText(/tap the moment each line starts/i)).toBeTruthy()
  })

  // The tap screen replaces the player UI entirely, so it needs its own audio
  // adjustments — a user timing lines can't otherwise change volume or slow
  // the song down.
  it('adjusts volume from the tap screen', () => {
    const { onVolumeChange } = renderEditor()
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '50' } })
    expect(onVolumeChange).toHaveBeenCalledWith(0.5)
  })

  it('adjusts playback speed from the tap screen', () => {
    const { onSpeedChange } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /Slow \(75%\)/i }))
    expect(onSpeedChange).toHaveBeenCalledWith(0.75)
  })

  it('returns to normal speed from the active preset', () => {
    const { onSpeedChange } = renderEditor({ speed: 0.75 })
    fireEvent.click(screen.getByRole('button', { name: /Slow \(75%\)/i }))
    expect(onSpeedChange).toHaveBeenCalledWith(1)
  })
})
