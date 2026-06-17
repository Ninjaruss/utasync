import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimestampPopover } from '../../src/lyrics/TimestampPopover'

describe('TimestampPopover', () => {
  it('shows a scrub slider seeded with the current time', () => {
    render(<TimestampPopover time={42} playhead={() => 0} onCommit={vi.fn()} onClose={vi.fn()} />)
    const slider = screen.getByLabelText('Scrub timestamp') as HTMLInputElement
    expect(Number(slider.value)).toBe(42)
  })

  it('dragging the slider updates the displayed time without committing', () => {
    const onCommit = vi.fn()
    render(<TimestampPopover time={42} playhead={() => 0} onCommit={onCommit} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Scrub timestamp'), { target: { value: '50' } })
    expect(screen.getByText('0:50')).toBeTruthy()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('"Use current" sets the draft to the live playhead value', () => {
    render(<TimestampPopover time={10} playhead={() => 77} onCommit={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText(/use current/i))
    expect(screen.getByText('1:17')).toBeTruthy()
  })

  it('Done commits the draft value and closes', () => {
    const onCommit = vi.fn()
    const onClose = vi.fn()
    render(<TimestampPopover time={10} playhead={() => 77} onCommit={onCommit} onClose={onClose} />)
    fireEvent.click(screen.getByText(/use current/i))
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith(77)
    expect(onClose).toHaveBeenCalled()
  })

  it('falls back to — for a negative playhead value instead of rendering malformed text', () => {
    render(<TimestampPopover time={10} playhead={() => -1} onCommit={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText(/use current/i))
    expect(screen.getAllByText('—', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/-1:-1/)).toBeNull()
  })

  it('falls back to — for a NaN playhead value instead of rendering malformed text', () => {
    render(<TimestampPopover time={10} playhead={() => NaN} onCommit={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText(/use current/i))
    expect(screen.getAllByText('—', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/NaN/)).toBeNull()
  })
})
