import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { DragRetimeStrip } from '../../src/player/DragRetimeStrip'
import { TimestampPopover } from '../../src/lyrics/TimestampPopover'

let frames: Map<number, FrameRequestCallback>
let clock: number
let sequence: number
beforeEach(() => {
  frames = new Map(); clock = 0; sequence = 0
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++sequence, cb); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function tick(count = 60) {
  for (let i = 0; i < count; i++) act(() => {
    clock += 16
    const pending = [...frames.values()]; frames.clear()
    pending.forEach(cb => cb(clock))
  })
}
function pointer(el: HTMLElement, type: string, x: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  fireEvent(el, event)
}
function track() {
  const el = screen.getByRole('slider') as HTMLInputElement
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 300 } as DOMRect)
  Object.assign(el, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() })
  return el
}

describe('waveform pointer dragging', () => {
  it('moves directly on the waveform, pans past the old range, and commits after release', () => {
    const onCommit = vi.fn(), onPreview = vi.fn()
    render(<DragRetimeStrip lineIndex={0} startSec={30} onCommit={onCommit} onPreview={onPreview} />)
    const el = track(), originalMax = Number(el.max)
    pointer(el, 'pointerdown', 200)
    pointer(el, 'pointermove', 300)
    expect(onPreview).toHaveBeenLastCalledWith(33.15)
    expect(Number(el.max)).toBe(originalMax)
    pointer(el, 'pointermove', 440)
    tick()
    expect(Number(el.value)).toBeGreaterThan(originalMax + 2)
    const released = Number(el.value)
    pointer(el, 'pointerup', 440)
    tick()
    expect(Number(el.value)).toBeCloseTo(released, 1)
    expect(frames.size).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(onCommit).toHaveBeenCalledWith(0, expect.any(Number), { clamped: false })
  })

  it('pans backwards but cannot pass zero; cancellation stops panning', () => {
    render(<DragRetimeStrip lineIndex={0} startSec={3} onCommit={vi.fn()} onPreview={vi.fn()} />)
    const el = track()
    pointer(el, 'pointerdown', 200)
    pointer(el, 'pointermove', 80)
    tick(120)
    expect(Number(el.min)).toBe(0)
    expect(Number(el.value)).toBe(0)
    pointer(el, 'pointercancel', 80)
    expect(frames.size).toBe(0)
  })

  it('ignores another pointer and stops when the control unmounts', () => {
    const { unmount } = render(<DragRetimeStrip lineIndex={0} startSec={30} onCommit={vi.fn()} onPreview={vi.fn()} />)
    const el = track()
    pointer(el, 'pointerdown', 200)
    const before = el.value
    pointer(el, 'pointermove', 440, 2)
    tick()
    expect(el.value).toBe(before)
    unmount()
    expect(frames.size).toBe(0)
  })

  it.each(['Start', 'End', 'Whole line'])('pans the %s editor and preserves timing constraints', (mode) => {
    const onCommit = vi.fn()
    render(<TimestampPopover line={{startTime:30,endTime:33,original:'test',translation:''}} autoEnd={40} onCommit={onCommit} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: mode, exact: true }))
    const el = track(), oldMax = Number(el.max)
    pointer(el, 'pointerdown', 250)
    pointer(el, 'pointermove', 440)
    tick()
    expect(Number(el.value)).toBeGreaterThan(oldMax + 2)
    pointer(el, 'pointerup', 440)
    fireEvent.click(screen.getByRole('button', { name:'Done' }))
    const patch = onCommit.mock.calls[0][0]
    if (mode === 'Whole line') expect(patch.end - patch.start).toBeCloseTo(3)
    if (mode === 'End') { expect(patch.start).toBe(30); expect(patch.end).toBeGreaterThan(oldMax) }
    if (mode === 'Start') expect(patch.end).toBeGreaterThanOrEqual(patch.start)
  })
})
