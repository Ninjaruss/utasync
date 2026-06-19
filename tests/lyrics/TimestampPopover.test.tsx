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
    const onScrub = vi.fn()
    render(<TimestampPopover time={42} playhead={() => 0} onCommit={onCommit} onClose={vi.fn()} onScrub={onScrub} />)
    fireEvent.change(screen.getByLabelText('Scrub timestamp'), { target: { value: '50' } })
    expect(screen.getByText('0:50')).toBeTruthy()
    expect(onScrub).toHaveBeenCalledWith(50)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('Done commits the draft value and closes', () => {
    const onCommit = vi.fn()
    const onClose = vi.fn()
    render(<TimestampPopover time={10} playhead={() => 77} onCommit={onCommit} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Scrub timestamp'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith(12)
    expect(onClose).toHaveBeenCalled()
  })
})
