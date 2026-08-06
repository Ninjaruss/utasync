import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TapSyncEditor } from '../../src/player/TapSyncEditor'

function renderEditor(overrides: Partial<Parameters<typeof TapSyncEditor>[0]> = {}) {
  const onComplete = vi.fn()
  const onCancel = vi.fn()
  render(
    <TapSyncEditor
      plainLines={['line one', 'line two', 'line three']}
      translations={['', '', '']}
      audioPosition={() => 1.5}
      onComplete={onComplete}
      onCancel={onCancel}
      isPlaying={false}
      onTogglePlay={vi.fn()}
      onSeek={vi.fn()}
      volume={1}
      onVolumeChange={vi.fn()}
      speed={1}
      onSpeedChange={vi.fn()}
      {...overrides}
    />,
  )
  return { onComplete, onCancel }
}

const tap = () => fireEvent.click(screen.getByRole('button', { name: 'Mark line start' }))

describe('TapSyncEditor — leaving the screen', () => {
  it('offers a way out at all times', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: /cancel tap-through/i })).toBeTruthy()
  })

  it('leaves immediately when nothing has been tapped', () => {
    const { onCancel } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /cancel tap-through/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('confirms before discarding taps, naming how many are at stake', () => {
    const { onCancel } = renderEditor()
    tap()
    tap()
    fireEvent.click(screen.getByRole('button', { name: /cancel tap-through/i }))

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByText(/2 tapped lines/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /keep tapping/i }))
    expect(onCancel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /cancel tap-through/i }))
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('treats Escape as the same request to leave', () => {
    const { onCancel } = renderEditor()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape with taps in progress asks first rather than discarding them', () => {
    const { onCancel } = renderEditor()
    tap()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByText(/1 tapped line/i)).toBeTruthy()
  })
})

describe('TapSyncEditor — saving part-way', () => {
  // A 58-line song shouldn't be a 58-tap commitment: whatever was tapped is
  // real timing data and is worth more to the user than nothing.
  it('can save before every line has been tapped', () => {
    const { onComplete } = renderEditor()
    tap()
    fireEvent.click(screen.getByRole('button', { name: /save timing/i }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('keeps untapped lines untimed instead of inventing timestamps for them', () => {
    const { onComplete } = renderEditor()
    tap()
    fireEvent.click(screen.getByRole('button', { name: /save timing/i }))

    const lines = onComplete.mock.calls[0][0]
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ startTime: 1.5, original: 'line one' })
    expect(lines[1]).toMatchObject({ startTime: 0, endTime: 0, original: 'line two' })
    expect(lines[2]).toMatchObject({ startTime: 0, endTime: 0, original: 'line three' })
  })

  it('says how much is saved so a partial pass is not mistaken for a full one', () => {
    renderEditor()
    tap()
    expect(screen.getByRole('button', { name: /save timing for 1 of 3/i })).toBeTruthy()
  })

  it('offers nothing to save until at least one line is tapped', () => {
    renderEditor()
    expect(screen.queryByRole('button', { name: /save timing/i })).toBeNull()
  })

  it('still times every line when the user does tap them all', () => {
    const { onComplete } = renderEditor()
    tap()
    tap()
    tap()
    fireEvent.click(screen.getByRole('button', { name: /save timing/i }))
    const lines = onComplete.mock.calls[0][0]
    expect(lines.every((l: { startTime: number }) => l.startTime === 1.5)).toBe(true)
  })
})

describe('TapSyncEditor — recent taps', () => {
  it('labels every recent tap, including the first two', () => {
    renderEditor()
    tap()
    tap()
    // A fixed -3 offset indexed off the start of the array and rendered a blank
    // label next to the timestamp.
    expect(screen.getByText(/line one · /i)).toBeTruthy()
    expect(screen.getByText(/line two · /i)).toBeTruthy()
  })
})

describe('TapSyncEditor — fitting on a phone', () => {
  it('scrolls rather than clipping its own Save and Undo controls', () => {
    renderEditor()
    const scroller = screen.getByTestId('tap-sync-scroll')
    expect(scroller.className).toMatch(/overflow-y-auto/)
    // justify-center would pin the column and push the ends out of reach on a
    // short viewport; the content must be allowed to start at the top instead.
    expect(scroller.className).not.toMatch(/justify-center/)
  })
})
