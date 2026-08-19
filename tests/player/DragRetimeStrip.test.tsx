import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { DragRetimeStrip } from '../../src/player/DragRetimeStrip'
import { computePeaks } from '../../src/player/waveformPeaks'

/**
 * The mechanic this replaces committed the playhead at the instant of a click,
 * so every correction carried the user's reaction latency (~250-400ms, always
 * late) into stored timing — where it was then marked 'good' and never
 * revisited. These specs pin that the control reports a time derived from
 * POSITION, never from when the interaction happened.
 */

const setup = (over: Partial<ComponentProps<typeof DragRetimeStrip>> = {}) => {
  const onCommit = vi.fn()
  const onPreview = vi.fn()
  render(
    <DragRetimeStrip
      lineIndex={3}
      lineText="テスト行"
      startSec={30}
      remaining={2}
      onCommit={onCommit}
      onPreview={onPreview}
      {...over}
    />,
  )
  return { onCommit, onPreview }
}

const slider = () => screen.getByRole('slider') as HTMLInputElement

describe('DragRetimeStrip', () => {
  it('renders nothing when there is no line to fix', () => {
    const { container } = render(
      <DragRetimeStrip lineIndex={null} startSec={0} onCommit={vi.fn()} onPreview={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('starts at the line current start', () => {
    setup()
    expect(Number(slider().value)).toBeCloseTo(30, 5)
  })

  // Live feedback is the whole reason a drag beats a tap: the user hears the
  // result while adjusting, instead of guessing and hoping.
  it('previews while dragging, without committing', () => {
    const { onPreview, onCommit } = setup()
    fireEvent.change(slider(), { target: { value: '29.2' } })
    expect(onPreview).toHaveBeenCalledWith(29.2)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the dragged time, not the time of the click', () => {
    const { onCommit } = setup()
    fireEvent.change(slider(), { target: { value: '28.8' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))
    expect(onCommit).toHaveBeenCalledWith(3, 28.8, { clamped: false })
  })

  it('shows how many spots remain', () => {
    setup({ remaining: 3 })
    expect(screen.getByText(/3 spots left/i)).toBeTruthy()
  })

  // The window is centred on the line's current start, so a mistimed line can be
  // nudged either way rather than only later.
  it('offers a range around the current start, not starting from it', () => {
    setup()
    expect(Number(slider().min)).toBeLessThan(30)
    expect(Number(slider().max)).toBeGreaterThan(30)
  })

  it('is reachable and labelled for keyboard and assistive tech', () => {
    setup()
    slider().focus()
    expect(document.activeElement).toBe(slider())
    expect(slider()).toHaveAccessibleName()
  })

  // Guards a real hazard: the parent re-renders as playback advances, and a
  // reset keyed on anything that changes during a drag would yank the thumb
  // out from under the user's finger.
  it('keeps the dragged value when the parent re-renders the same line', () => {
    const onPreview = vi.fn()
    const onCommit = vi.fn()
    const { rerender } = render(
      <DragRetimeStrip lineIndex={3} startSec={30} remaining={2} onPreview={onPreview} onCommit={onCommit} />,
    )
    fireEvent.change(slider(), { target: { value: '28.5' } })
    rerender(
      <DragRetimeStrip lineIndex={3} startSec={30} remaining={1} onPreview={onPreview} onCommit={onCommit} />,
    )
    expect(Number(slider().value)).toBeCloseTo(28.5, 5)
  })

  // The range must not shift under the user's finger, so it is frozen against
  // ordinary parent re-renders (asserted above, where startSec is unchanged).
  // It is NOT frozen against the same line's start genuinely moving: after a
  // clamped commit the line is deliberately left flagged and offered again, and
  // a window still centred on the old start would hand the user the same
  // unreachable edge forever instead of letting them walk the line home.
  it('re-centres when the same line reports a genuinely moved start', () => {
    const onPreview = vi.fn()
    const onCommit = vi.fn()
    const { rerender } = render(
      <DragRetimeStrip lineIndex={3} startSec={30} onPreview={onPreview} onCommit={onCommit} />,
    )
    const max = Number(slider().max)
    rerender(
      <DragRetimeStrip lineIndex={3} startSec={max} onPreview={onPreview} onCommit={onCommit} />,
    )
    expect(Number(slider().value)).toBeCloseTo(max, 5)
    expect(Number(slider().max)).toBeGreaterThan(max)
  })

  // The other half: a commit made against the window's edge has to say so, or
  // the caller cannot tell "I found the spot" from "I ran out of slider".
  it('reports a commit made at the edge of the window as clamped', () => {
    const { onCommit } = setup()
    fireEvent.change(slider(), { target: { value: slider().max } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))
    expect(onCommit).toHaveBeenCalledWith(3, expect.any(Number), { clamped: true })
  })

  it('re-centres when it moves to a different line', () => {
    const onPreview = vi.fn()
    const onCommit = vi.fn()
    const { rerender } = render(
      <DragRetimeStrip lineIndex={3} startSec={30} onPreview={onPreview} onCommit={onCommit} />,
    )
    fireEvent.change(slider(), { target: { value: '28.5' } })
    rerender(
      <DragRetimeStrip lineIndex={4} startSec={44} onPreview={onPreview} onCommit={onCommit} />,
    )
    expect(Number(slider().value)).toBeCloseTo(44, 5)
  })
})

/**
 * Re-timing by ear alone gave the eye nothing to aim at — usable, but a poor
 * experience to sync with. The waveform is that anchor, and it has to degrade
 * honestly: a track with no PCM (YouTube) must say so rather than showing a flat
 * line that looks like silence.
 */
describe('DragRetimeStrip waveform', () => {
  /** Silence with a burst at burstSec, at a sample rate cheap enough for a test. */
  const peaksWithBurst = (burstSec: number) => {
    const sr = 1000
    const pcm = new Float32Array(120 * sr)
    for (let i = Math.floor(burstSec * sr); i < Math.floor((burstSec + 0.4) * sr); i++) pcm[i] = 0.9
    return computePeaks(pcm, sr)
  }

  it('draws the audio when peaks are available', () => {
    const { container } = render(
      <DragRetimeStrip
        lineIndex={3} startSec={30} peaks={peaksWithBurst(30)} waveformState="ready"
        onPreview={vi.fn()} onCommit={vi.fn()}
      />,
    )
    expect(container.querySelector('svg')).toBeTruthy()
    // More than a couple of bars, i.e. an actual waveform rather than a placeholder.
    expect(container.querySelectorAll('svg rect').length).toBeGreaterThan(50)
  })

  it('says it is still reading rather than showing a flat line', () => {
    render(
      <DragRetimeStrip
        lineIndex={3} startSec={30} peaks={null} waveformState="pending"
        onPreview={vi.fn()} onCommit={vi.fn()}
      />,
    )
    expect(screen.getByText(/reading the audio/i)).toBeTruthy()
  })

  // The YouTube case. A flat line would read as "this part is silent", which is a
  // lie about the audio.
  it('says a track has no waveform when there is no PCM to read', () => {
    render(
      <DragRetimeStrip
        lineIndex={3} startSec={30} peaks={null} waveformState="unavailable"
        onPreview={vi.fn()} onCommit={vi.fn()}
      />,
    )
    expect(screen.getByText(/no waveform/i)).toBeTruthy()
  })

  // Losing the waveform must never cost the control itself.
  it('still re-times with no waveform at all', () => {
    const onCommit = vi.fn()
    render(
      <DragRetimeStrip
        lineIndex={3} startSec={30} waveformState="unavailable"
        onPreview={vi.fn()} onCommit={onCommit}
      />,
    )
    fireEvent.change(slider(), { target: { value: '29.5' } })
    fireEvent.click(screen.getByRole('button', { name: /use this/i }))
    expect(onCommit).toHaveBeenCalledWith(3, 29.5, { clamped: false })
  })
})

/**
 * The range input is transparent — every mark is drawn on the audio's axis instead,
 * because the native thumb is sized by the browser and a marker aligned to it in
 * Chromium drifts in Gecko. That makes the focus ring load-bearing: without it a
 * keyboard user gets an invisible control.
 */
describe('DragRetimeStrip keyboard affordance', () => {
  it('shows focus on the waveform when the hidden input takes focus', () => {
    const { container } = render(
      <DragRetimeStrip lineIndex={3} startSec={30} waveformState="unavailable"
        onPreview={vi.fn()} onCommit={vi.fn()} />,
    )
    // The container that owns the shared geometry carries the focus style, since the
    // input itself is invisible.
    const box = container.querySelector('[class*="focus-within:ring"]')
    expect(box).toBeTruthy()
    expect(box!.contains(slider())).toBe(true)
  })

  it('keeps the slider role, label and keyboard stepping', () => {
    render(
      <DragRetimeStrip lineIndex={3} startSec={30} waveformState="unavailable"
        onPreview={vi.fn()} onCommit={vi.fn()} />,
    )
    const el = slider()
    el.focus()
    expect(document.activeElement).toBe(el)
    expect(el).toHaveAccessibleName()
    expect(el.step).toBe('0.05')
  })
})
