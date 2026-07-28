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
// first: mixed-realign > lyrics-mismatch > recover > approximate-timing > stray.
// The reliable fix (tap-to-anchor) is the headline action; word-level re-align —
// measurably worse on long tracks — is a de-emphasized More item, never a notice CTA.
describe('EditMode alignment notice', () => {
  it('warns of a likely lyrics/recording mismatch when confidence is low', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.3 })
    expect(screen.getByText(/may not match this recording/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /fix by tapping/i })).toBeNull()
  })

  it('surfaces the approximate-timing notice; word-level re-align lives in More, not as a notice CTA', () => {
    const { onAutoAlignAccurate } = renderHint({
      lineAlignmentQuality: allGood,
      alignmentConfidence: 0.9,
      accurateRealignReason: 'segment-blocks',
    })
    expect(screen.getByText(/line timings are approximate/i)).toBeTruthy()
    // The word-mode re-align is NOT a headline notice button (it's a trap on long tracks)…
    expect(screen.queryByRole('button', { name: /^re-align$/i })).toBeNull()
    // …it's reachable, de-emphasized, from More.
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    fireEvent.click(screen.getByRole('button', { name: /word-level/i }))
    expect(onAutoAlignAccurate).toHaveBeenCalledTimes(1)
  })

  it('mismatch takes priority over the approximate-timing notice', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.3, accurateRealignReason: 'segment-blocks' })
    expect(screen.getByText(/may not match this recording/i)).toBeTruthy()
    expect(screen.queryByText(/line timings are approximate/i)).toBeNull()
  })

  it('collapses weak-labels into the same approximate-timing notice', () => {
    const weakLines: TimedLine[] = Array.from({ length: 8 }, (_, i) => ({
      startTime: i * 3 + 1,
      endTime: i * 3 + 4,
      original: `row ${i}`,
      translation: '',
    }))
    const quality: LineAlignmentQuality[] = [
      'good', 'good', 'approximate', 'approximate', 'approximate', 'needs_review', 'needs_review', 'needs_review',
    ]
    renderHint({
      lines: weakLines,
      lineAlignmentQuality: quality,
      alignmentConfidence: 0.9,
      accurateRealignReason: 'weak-labels',
    })
    expect(screen.getByText(/lines may be off/i)).toBeTruthy()
  })

  it('offers "Fix by tapping" (the tap-anchor bridge) when one is available', () => {
    const onFixTiming = vi.fn()
    renderHint({ lineAlignmentQuality: ['needs_review', 'good'], alignmentConfidence: 0.9, onFixTiming })
    expect(screen.getByText(/tap them in time to fix/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /fix by tapping/i }))
    expect(onFixTiming).toHaveBeenCalledTimes(1)
  })

  it('shows the plain off-timing notice (nudge) when no tap-fix is available', () => {
    renderHint({ lineAlignmentQuality: ['needs_review', 'good'], alignmentConfidence: 0.9 })
    expect(screen.getByText(/1 line may be off/i)).toBeTruthy()
    expect(screen.getByText(/nudge the times below/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /fix by tapping/i })).toBeNull()
  })

  it('shows no notice for a healthy alignment', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.9 })
    expect(screen.queryByText(/may be off/i)).toBeNull()
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
    expect(screen.queryByText(/may be off/i)).toBeNull()
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
    expect(screen.queryByText(/may be off/i)).toBeNull()
  })
})
