import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TapSyncEditor } from '../../src/player/TapSyncEditor'

function renderEditor(overrides: Partial<Parameters<typeof TapSyncEditor>[0]> = {}) {
  const onComplete = vi.fn()
  const onTogglePlay = vi.fn()
  const onSeek = vi.fn()
  render(
    <TapSyncEditor
      plainLines={['line one']}
      translations={['']}
      audioPosition={() => 1.5}
      onComplete={onComplete}
      isPlaying={false}
      onTogglePlay={onTogglePlay}
      onSeek={onSeek}
      {...overrides}
    />,
  )
  return { onComplete, onTogglePlay, onSeek }
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
})
