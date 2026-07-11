import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 0, endTime: 0, original: 'b', translation: '' }, // untimed
]

function renderEditMode(overrides: Partial<Parameters<typeof EditMode>[0]> = {}) {
  const onChangeLines = vi.fn()
  const onAutoAlign = vi.fn()
  const utils = render(
    <EditMode
      lines={lines}
      playhead={() => 9}
      hasLocalAudio
      onChangeLines={onChangeLines}
      onAutoAlign={onAutoAlign}
      title="t"
      artist="a"
      sourceLanguage="ja"
      {...overrides}
    />,
  )
  return { onChangeLines, onAutoAlign, ...utils }
}

describe('EditMode', () => {
  it('tapping the timestamp pill opens a popover instead of stamping', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Scrub start timestamp')).toBeTruthy()
  })

  it('committing the popover stamps the chosen time', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '9' } })
    fireEvent.click(screen.getByText('Done'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].startTime).toBe(9)
  })

  it('committing an end anchor from the popover stamps endTime', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 1/i }))
    fireEvent.click(screen.getByRole('tab', { name: 'End' }))
    fireEvent.change(screen.getByLabelText('Scrub end timestamp'), { target: { value: '3.5' } })
    fireEvent.click(screen.getByText('Done'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[0]).toMatchObject({ startTime: 0, endTime: 3.5 })
  })

  it('dismissing the popover does not stamp and reverts the preview position', () => {
    const seek = vi.fn()
    const onScrubEnd = vi.fn()
    const { onChangeLines } = renderEditMode({ seek, onScrubStart: vi.fn(), onScrubEnd, playhead: () => 4 })
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '9' } })
    expect(seek).toHaveBeenCalledWith(9)
    const list = screen.getByLabelText('Lyric lines')
    fireEvent.click(list)
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(seek).toHaveBeenLastCalledWith(4)
    expect(onScrubEnd).toHaveBeenCalled()
    expect(screen.queryByLabelText('Scrub start timestamp')).toBeNull()
  })

  it('tapping another lyric cancels an open timestamp preview', () => {
    const seek = vi.fn()
    const onScrubEnd = vi.fn()
    renderEditMode({ seek, onScrubStart: vi.fn(), onScrubEnd, playhead: () => 4 })
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '9' } })
    fireEvent.click(screen.getByText('a'))
    expect(seek).toHaveBeenCalledWith(4)
    expect(onScrubEnd).toHaveBeenCalled()
    expect(screen.queryByLabelText('Scrub start timestamp')).toBeNull()
    expect(screen.getByLabelText('Original text')).toBeTruthy()
  })

  it('opens inline editing (does NOT stamp) when the lyric text is tapped', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Original text')).toBeTruthy()
  })

  it('commits text on blur, not on every keystroke', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    expect(onChangeLines).not.toHaveBeenCalled()
    fireEvent.blur(input)
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].original).toBe('bb')
  })

  it('shows add/delete icons only while editing', () => {
    renderEditMode()
    expect(screen.queryByLabelText('Delete line 2')).toBeNull()
    fireEvent.click(screen.getByText('b'))
    expect(screen.getByLabelText('Delete line 2')).toBeTruthy()
    expect(screen.getByLabelText('Add line after 2')).toBeTruthy()
  })

  it('requires two taps to delete a line', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    fireEvent.click(screen.getByLabelText('Delete line 2'))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Confirm delete line 2')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Confirm delete line 2'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next.length).toBe(1)
  })

  it('shows Auto-align only when audio is available, with a confirm dialog before triggering it', () => {
    const { onAutoAlign } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /auto-align/i }))
    expect(onAutoAlign).not.toHaveBeenCalled()
    expect(screen.getByText(/replaces timing for all 2 lines/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Continue'))
    expect(onAutoAlign).toHaveBeenCalled()
  })

  it('shows a local-audio hint instead of Auto-align when hasLocalAudio is false', () => {
    renderEditMode({ hasLocalAudio: false })
    expect(screen.queryByRole('button', { name: /auto-align/i })).toBeNull()
    expect(screen.getByText(/tap-through to time lyrics/i)).toBeTruthy()
  })

  it('marks untimed lines', () => {
    renderEditMode()
    expect(screen.getByText(/untimed/i)).toBeTruthy()
  })

  it('shows alignment quality warnings for auto-aligned rows', () => {
    renderEditMode({
      lineAlignmentQuality: ['good', 'needs_review'],
      showAlignmentQuality: true,
    })
    expect(screen.getAllByText(/off-timing/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/1.*off-timing/i)).toBeTruthy()
  })

  it('hides alignment quality badges when showAlignmentQuality is false', () => {
    renderEditMode({
      lineAlignmentQuality: ['needs_review', 'needs_review'],
      showAlignmentQuality: false,
    })
    expect(screen.queryByText(/timing approximate/i)).toBeNull()
  })

  it('opens the second-language panel from the toolbar', async () => {
    renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /translation/i }))
    expect(await screen.findByRole('heading', { name: /second language/i })).toBeTruthy()
  })

  it('pauses playback when opening the second-language panel', async () => {
    const onPausePlayback = vi.fn()
    renderEditMode({ onPausePlayback })
    fireEvent.click(screen.getByRole('button', { name: /translation/i }))
    expect(onPausePlayback).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: /second language/i })).toBeTruthy()
  })

  it('does not clobber an in-progress draft when lines change externally while editing', () => {
    const { rerender } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'draft in progress' } })
    expect(input.value).toBe('draft in progress')

    // Simulate an external lines update (e.g. SecondLanguagePanel.onApply) while
    // this row is still being edited — its translation changes but original stays.
    const updatedLines: TimedLine[] = [
      lines[0],
      { ...lines[1], translation: 'new translation from elsewhere' },
    ]
    rerender(
      <EditMode
        lines={updatedLines}
        playhead={() => 9}
        hasLocalAudio
        onChangeLines={vi.fn()}
        onAutoAlign={vi.fn()}
        title="t"
        artist="a"
        sourceLanguage="ja"
      />,
    )

    expect((screen.getByLabelText('Original text') as HTMLInputElement).value).toBe('draft in progress')
  })

  it('requires a fresh tap to re-arm delete after switching to a different row', () => {
    renderEditMode()
    // Arm delete on line 2 ("b").
    fireEvent.click(screen.getByText('b'))
    fireEvent.click(screen.getByLabelText('Delete line 2'))
    expect(screen.getByLabelText('Confirm delete line 2')).toBeTruthy()

    // Switch to editing line 1 ("a") instead, within the confirm window.
    fireEvent.click(screen.getByText('a'))

    // Switch back to line 2 — it should require a fresh tap, not show Confirm? immediately.
    fireEvent.click(screen.getByLabelText('Edit line 2'))
    expect(screen.queryByLabelText('Confirm delete line 2')).toBeNull()
    expect(screen.getByLabelText('Delete line 2')).toBeTruthy()
  })

  it('highlights the row under the current playhead', () => {
    const timedLines: TimedLine[] = [
      { startTime: 0, endTime: 2, original: 'first', translation: '' },
      { startTime: 2, endTime: 5, original: 'second', translation: '' },
    ]
    const { container } = render(
      <EditMode
        lines={timedLines}
        playhead={() => 1}
        playheadPosition={1}
        hasLocalAudio
        onChangeLines={vi.fn()}
        onAutoAlign={vi.fn()}
        title="t"
        artist="a"
        sourceLanguage="ja"
      />,
    )
    const rows = container.querySelectorAll('[class*="ring-cinnabar-accent"]')
    expect(rows.length).toBe(1)
    expect(rows[0].textContent).toMatch(/first/)
  })

  it('undo restores the previous lines after a text edit', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)
    expect(onChangeLines).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const undone = onChangeLines.mock.calls[1][0] as TimedLine[]
    expect(undone[1].original).toBe('b')
  })

  it('redo re-applies the change after an undo', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    const redone = onChangeLines.mock.calls[2][0] as TimedLine[]
    expect(redone[1].original).toBe('bb')
  })

  it('undo/redo buttons are disabled when there is nothing to undo/redo', () => {
    renderEditMode()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  it('a new edit clears the redo stack', () => {
    renderEditMode()
    fireEvent.click(screen.getByText('b'))
    const input = screen.getByLabelText('Original text')
    fireEvent.change(input, { target: { value: 'bb' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Redo' })).not.toBeDisabled()

    fireEvent.click(screen.getByText('a'))
    const input2 = screen.getByLabelText('Original text')
    fireEvent.change(input2, { target: { value: 'aa' } })
    fireEvent.blur(input2)

    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })
})

describe('EditMode — local re-align', () => {
  it('shows static off-timing chip when there are needs_review lines', () => {
    renderEditMode({
      lineAlignmentQuality: ['good', 'needs_review'],
      showAlignmentQuality: true,
    })
    expect(screen.getByText('off-timing')).toBeTruthy()
  })

  it('does not render a bulk re-align button', () => {
    renderEditMode({
      lineAlignmentQuality: ['needs_review', 'needs_review'],
      showAlignmentQuality: true,
    })
    expect(screen.queryByRole('button', { name: /re-align.*weak/i })).toBeNull()
  })
})
