import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 3, endTime: 5, original: 'b', translation: '' },
]

function renderEditMode(overrides: Partial<Parameters<typeof EditMode>[0]> = {}) {
  const onAutoAlign = vi.fn()
  const onTapSync = vi.fn()
  const utils = render(
    <EditMode
      lines={lines}
      playhead={() => 0}
      hasLocalAudio
      onChangeLines={vi.fn()}
      onAutoAlign={onAutoAlign}
      onTapSync={onTapSync}
      showTapSync
      title="t"
      artist="a"
      sourceLanguage="ja"
      {...overrides}
    />,
  )
  return { onAutoAlign, onTapSync, ...utils }
}

describe('EditMode auto-align availability', () => {
  it('offers Auto-align on a device that can run it', () => {
    renderEditMode({ autoAlignSupported: true })
    expect(screen.getByRole('button', { name: /^auto-align$/i })).toBeTruthy()
  })

  // Regression: the button was gated on hasLocalAudio only. A manual-tier user
  // confirmed "this takes a few minutes", then landed in a modal whose entire
  // content was "Your device does not support on-device AI" and a Cancel link.
  it('does not offer Auto-align when the device cannot run it', () => {
    renderEditMode({ autoAlignSupported: false })
    expect(screen.queryByRole('button', { name: /^auto-align$/i })).toBeNull()
  })

  it('points at Tap-through instead, as the primary action', () => {
    const { onTapSync } = renderEditMode({ autoAlignSupported: false })
    const tap = screen.getByRole('button', { name: /^tap-through$/i })
    fireEvent.click(tap)
    expect(onTapSync).toHaveBeenCalledTimes(1)
  })

  it('says why Auto-align is missing rather than leaving a gap', () => {
    renderEditMode({ autoAlignSupported: false })
    expect(screen.getByText(/can't run on-device ai/i)).toBeTruthy()
  })

  it('still explains the no-audio case separately', () => {
    renderEditMode({ hasLocalAudio: false, autoAlignSupported: true })
    expect(screen.getByText(/no audio file/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^auto-align$/i })).toBeNull()
  })

  it('treats auto-align as available by default', () => {
    renderEditMode()
    expect(screen.getByRole('button', { name: /^auto-align$/i })).toBeTruthy()
  })
})
