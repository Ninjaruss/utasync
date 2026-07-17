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
    // Readout keeps tenths so sub-second nudges are visible.
    expect(screen.getByText('0:50.0')).toBeTruthy()
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

  // Wave 2, item 2: nudge buttons + "Use current position" + a draft-relative
  // window so a badly-misplaced line can actually be moved, not just wiggled.
  it('nudging +0.1s raises the draft start', () => {
    const onCommit = vi.fn()
    renderPopover(line(10), { onCommit })
    fireEvent.click(screen.getByRole('button', { name: /forward 0\.1 seconds/i }))
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith({ start: 10.1, end: null })
  })

  it('nudging −0.5s lowers the draft start', () => {
    const onCommit = vi.fn()
    renderPopover(line(10), { onCommit })
    fireEvent.click(screen.getByRole('button', { name: /back 0\.5 seconds/i }))
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith({ start: 9.5, end: null })
  })

  it('nudges the active End anchor, keeping it after the start', () => {
    const onCommit = vi.fn()
    renderPopover(line(10, 15), { onCommit })
    fireEvent.click(screen.getByRole('tab', { name: 'End' }))
    fireEvent.click(screen.getByRole('button', { name: /forward 0\.5 seconds/i }))
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith({ start: 10, end: 15.5 })
  })

  it('"Use current position" snaps the draft start to the current playhead', () => {
    const onCommit = vi.fn()
    const onScrub = vi.fn()
    renderPopover(line(10), { onCommit, onScrub, playhead: () => 88 })
    fireEvent.click(screen.getByRole('button', { name: /use current position/i }))
    // 88s is well outside the original ±15s window — the readout still shows it.
    expect(screen.getByText('1:28.0')).toBeTruthy()
    expect(onScrub).toHaveBeenCalledWith(88)
    fireEvent.click(screen.getByText('Done'))
    expect(onCommit).toHaveBeenCalledWith({ start: 88, end: null })
  })

  it('re-centers the scrub window on the draft so it never dead-ends at the edge', () => {
    renderPopover(line(10), { playhead: () => 88 })
    fireEvent.click(screen.getByRole('button', { name: /use current position/i }))
    const slider = screen.getByLabelText('Scrub start timestamp') as HTMLInputElement
    // Window followed the jump to 88 rather than staying pinned near 10.
    expect(Number(slider.max)).toBeGreaterThan(88)
    expect(Number(slider.min)).toBeGreaterThan(60)
  })
})
