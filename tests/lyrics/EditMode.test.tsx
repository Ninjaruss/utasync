import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 0, endTime: 2, original: 'a', translation: '' },
  { startTime: 0, endTime: 0, original: 'b', translation: '' }, // untimed
]

describe('EditMode', () => {
  it('stamps the playhead onto a line when its row is tapped (simple path)', () => {
    const onChangeLines = vi.fn()
    render(<EditMode lines={lines} playhead={() => 9} hasAudio onChangeLines={onChangeLines} onTapThrough={vi.fn()} onAutoAlign={vi.fn()} />)
    fireEvent.click(screen.getByText('b'))
    expect(onChangeLines).toHaveBeenCalled()
    const next = onChangeLines.mock.calls[0][0] as TimedLine[]
    expect(next[1].startTime).toBe(9)
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
