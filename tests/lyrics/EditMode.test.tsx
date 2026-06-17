import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 0, endTime: 0, original: 'b', translation: '' }, // untimed
]

describe('EditMode', () => {
  it('stamps the playhead when the timestamp pill is tapped', () => {
    const onChangeLines = vi.fn()
    render(<EditMode lines={lines} playhead={() => 9} hasAudio onChangeLines={onChangeLines} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /set start to current time for line 2/i }))
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].startTime).toBe(9)
  })

  it('opens the editor (does NOT stamp) when the lyric text is tapped', () => {
    const onChangeLines = vi.fn()
    render(<EditMode lines={lines} playhead={() => 9} hasAudio onChangeLines={onChangeLines} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    fireEvent.click(screen.getByText('b'))
    expect(onChangeLines).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Original text')).toBeTruthy()
  })

  it('shows Auto-align only when audio is available', () => {
    const { rerender } = render(<EditMode lines={lines} playhead={() => 0} hasAudio onChangeLines={vi.fn()} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    expect(screen.getByRole('button', { name: /auto-align/i })).toBeTruthy()
    rerender(<EditMode lines={lines} playhead={() => 0} hasAudio={false} onChangeLines={vi.fn()} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /auto-align/i })).toBeNull()
    expect(screen.getByText(/needs a youtube or uploaded audio/i)).toBeTruthy()
  })

  it('marks untimed lines', () => {
    render(<EditMode lines={lines} playhead={() => 0} hasAudio onChangeLines={vi.fn()} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    expect(screen.getByText(/untimed/i)).toBeTruthy()
  })
})
