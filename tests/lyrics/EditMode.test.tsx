import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

vi.mock('../../src/sources/lrclib', () => ({
  findSecondLanguageLyrics: () => new Promise(() => {}),
}))

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 0, endTime: 0, original: 'b', translation: '' }, // untimed
]

function renderEditMode(overrides: Partial<Parameters<typeof EditMode>[0]> = {}) {
  const onChangeLines = vi.fn()
  const onAutoAlign = vi.fn()
  render(
    <EditMode
      lines={lines}
      playhead={() => 9}
      hasAudio
      onChangeLines={onChangeLines}
      onAutoAlign={onAutoAlign}
      title="t"
      artist="a"
      sourceLanguage="ja"
      {...overrides}
    />,
  )
  return { onChangeLines, onAutoAlign }
}

describe('EditMode', () => {
  it('tapping the timestamp pill opens a popover instead of stamping', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Scrub timestamp')).toBeTruthy()
  })

  it('committing the popover stamps the chosen time', () => {
    const { onChangeLines } = renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /edit timestamp for line 2/i }))
    fireEvent.click(screen.getByText(/use current/i))
    fireEvent.click(screen.getByText('Done'))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].startTime).toBe(9)
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

  it('shows a locally-stored-audio hint instead of Auto-align when hasAudio is false', () => {
    renderEditMode({ hasAudio: false })
    expect(screen.queryByRole('button', { name: /auto-align/i })).toBeNull()
    expect(screen.getByText(/needs locally stored audio/i)).toBeTruthy()
  })

  it('marks untimed lines', () => {
    renderEditMode()
    expect(screen.getByText(/untimed/i)).toBeTruthy()
  })

  it('opens the second-language panel from the footer button', async () => {
    renderEditMode()
    fireEvent.click(screen.getByRole('button', { name: /2nd language/i }))
    expect(await screen.findByText(/searching lrclib/i)).toBeTruthy()
  })
})
