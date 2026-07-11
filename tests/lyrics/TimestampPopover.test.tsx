import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimestampPopover } from '../../src/lyrics/TimestampPopover'
import type { TimedLine } from '../../src/core/types'

const line = (startTime: number, endTime = startTime): TimedLine => ({ startTime, endTime, original: 'a', translation: '' })

const renderPopover = (l: TimedLine, over: Partial<Parameters<typeof TimestampPopover>[0]> = {}) =>
  render(<TimestampPopover line={l} autoEnd={l.startTime + 4} playhead={() => 0} onCommit={vi.fn()} onClose={vi.fn()} {...over} />)

describe('TimestampPopover', () => {
  it('shows a scrub slider seeded with the line start', () => {
    renderPopover(line(42))
    const slider = screen.getByLabelText('Scrub start timestamp') as HTMLInputElement
    expect(Number(slider.value)).toBe(42)
  })

  it('dragging the slider updates the displayed time without committing', () => {
    const onCommit = vi.fn()
    const onScrub = vi.fn()
    renderPopover(line(42), { onCommit, onScrub })
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '50' } })
    expect(screen.getByText('0:50')).toBeTruthy()
    expect(onScrub).toHaveBeenCalledWith(50)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('Done commits the draft start (end stays auto) and closes', () => {
    const onCommit = vi.fn()
    const onClose = vi.fn()
    renderPopover(line(10), { onCommit, onClose })
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith({ start: 12, end: null })
    expect(onClose).toHaveBeenCalled()
  })

  it('switching to End shows an auto end seeded from the next line, and dragging makes it explicit', () => {
    const onCommit = vi.fn()
    renderPopover(line(10), { onCommit })
    expect(screen.getByText('auto')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'End' }))
    const slider = screen.getByLabelText('Scrub end timestamp') as HTMLInputElement
    expect(Number(slider.value)).toBe(14) // autoEnd = start + 4
    fireEvent.change(slider, { target: { value: '13' } })
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith({ start: 10, end: 13 })
  })

  it('an explicit end seeds the End slider and Auto clears it back to null', () => {
    const onCommit = vi.fn()
    renderPopover(line(10, 15), { onCommit })
    fireEvent.click(screen.getByRole('tab', { name: 'End' }))
    expect(Number((screen.getByLabelText('Scrub end timestamp') as HTMLInputElement).value)).toBe(15)
    fireEvent.click(screen.getByText('Auto'))
    expect(screen.getByText('auto')).toBeTruthy()
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith({ start: 10, end: null })
  })

  it('the End slider cannot precede the draft start', () => {
    renderPopover(line(10, 11))
    fireEvent.click(screen.getByRole('tab', { name: 'End' }))
    const slider = screen.getByLabelText('Scrub end timestamp') as HTMLInputElement
    expect(Number(slider.min)).toBeGreaterThan(10)
  })

  it('dragging the start past an explicit end drags the end along', () => {
    const onCommit = vi.fn()
    renderPopover(line(10, 12), { onCommit })
    fireEvent.change(screen.getByLabelText('Scrub start timestamp'), { target: { value: '14' } })
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith({ start: 14, end: 14 })
  })
})
