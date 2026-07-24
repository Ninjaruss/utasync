import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { LineAlignmentQuality, TimedLine } from '../../src/core/types'

const lines: TimedLine[] = [
  { startTime: 1, endTime: 4, original: 'a', translation: '' },
  { startTime: 4, endTime: 7, original: 'b', translation: '' },
]

function renderHint(overrides: Partial<Parameters<typeof EditMode>[0]> = {}) {
  const onAutoAlignAccurate = vi.fn()
  const utils = render(
    <EditMode
      lines={lines}
      playhead={() => 0}
      hasLocalAudio
      onChangeLines={vi.fn()}
      onAutoAlign={vi.fn()}
      onAutoAlignAccurate={onAutoAlignAccurate}
      title="t"
      artist="a"
      sourceLanguage="ja"
      {...overrides}
    />,
  )
  return { onAutoAlignAccurate, ...utils }
}

const allGood: LineAlignmentQuality[] = ['good', 'good']

// The top of Edit shows ONE consolidated status notice at a time, most-actionable
// first: mixed-realign > lyrics-mismatch > recover > approx-timing > off-timing.
describe('EditMode alignment notice', () => {
  it('warns of a likely lyrics/recording mismatch when confidence is low', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.3 })
    expect(screen.getByText(/may not match this recording/i)).toBeTruthy()
    // No re-align on a mismatch — it can't fix un-matching lyrics.
    expect(screen.queryByRole('button', { name: /re-align/i })).toBeNull()
  })

  it('offers a re-align for approximate (block) timing even when every row scores good', () => {
    // Tail-clipping case: lines score "good" yet share coarse blocks, so the
    // approximate-timing notice must still surface with the re-align CTA.
    const { onAutoAlignAccurate } = renderHint({
      lineAlignmentQuality: allGood,
      alignmentConfidence: 0.9,
      accurateRealignReason: 'segment-blocks',
    })
    expect(screen.getByText(/line timings are approximate/i)).toBeTruthy()
    const btn = screen.getByRole('button', { name: /re-align/i })
    fireEvent.click(btn)
    expect(onAutoAlignAccurate).toHaveBeenCalledTimes(1)
  })

  it('mismatch takes priority over the approximate-timing notice', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.3, accurateRealignReason: 'segment-blocks' })
    expect(screen.getByText(/may not match this recording/i)).toBeTruthy()
    expect(screen.queryByText(/line timings are approximate/i)).toBeNull()
  })

  it('collapses weak-labels into the same approximate-timing notice + re-align', () => {
    const weakLines: TimedLine[] = Array.from({ length: 8 }, (_, i) => ({
      startTime: i * 3 + 1,
      endTime: i * 3 + 4,
      original: `row ${i}`,
      translation: '',
    }))
    const quality: LineAlignmentQuality[] = [
      'good', 'good', 'approximate', 'approximate', 'approximate', 'needs_review', 'needs_review', 'needs_review',
    ]
    const { onAutoAlignAccurate } = renderHint({
      lines: weakLines,
      lineAlignmentQuality: quality,
      alignmentConfidence: 0.9,
      accurateRealignReason: 'weak-labels',
    })
    expect(screen.getByText(/line timings are approximate/i)).toBeTruthy()
    const btn = screen.getByRole('button', { name: /re-align/i })
    fireEvent.click(btn)
    expect(onAutoAlignAccurate).toHaveBeenCalledTimes(1)
  })

  it('shows the plain off-timing nudge for a few stray rows', () => {
    renderHint({ lineAlignmentQuality: ['needs_review', 'good'], alignmentConfidence: 0.9 })
    expect(screen.getByText(/1 line may be slightly off/i)).toBeTruthy()
    expect(screen.queryByText(/may not match this recording/i)).toBeNull()
  })

  it('shows no notice for a healthy alignment', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.9 })
    expect(screen.queryByText(/may be slightly off/i)).toBeNull()
    expect(screen.queryByText(/may not match this recording/i)).toBeNull()
    expect(screen.queryByText(/line timings are approximate/i)).toBeNull()
  })

  it('does not stack the mixed-realign notice with a quality notice', () => {
    renderHint({
      lineAlignmentQuality: ['needs_review', 'good'],
      alignmentConfidence: 0.9,
      needsMixedRealign: true,
    })
    expect(screen.getByText(/timed by an older version/i)).toBeTruthy()
    // The generic off-timing nudge must not also render beneath it.
    expect(screen.queryByText(/may be slightly off/i)).toBeNull()
  })

  it('shows the targeted Re-scan notice, not the generic off-timing nudge, when gaps are recoverable', () => {
    renderHint({
      lineAlignmentQuality: ['needs_review', 'good'],
      alignmentConfidence: 0.9,
      recoverableGapCount: 1,
      onRecoverGaps: vi.fn(),
    })
    expect(screen.getByRole('button', { name: /re-scan/i })).toBeTruthy()
    expect(screen.getByText(/couldn.t be timed/i)).toBeTruthy()
    // …so the duplicate generic off-timing banner is gone.
    expect(screen.queryByText(/may be slightly off/i)).toBeNull()
  })
})
