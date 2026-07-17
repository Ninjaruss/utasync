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

describe('EditMode alignment hint', () => {
  it('warns of a likely lyrics/recording mismatch when confidence is low', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.3 })
    expect(screen.getByText(/may not match this recording/i)).toBeTruthy()
    // No accuracy re-align on a mismatch — it can't fix un-matching lyrics.
    expect(screen.queryByRole('button', { name: /re-align accurately/i })).toBeNull()
  })

  it('offers an accurate re-align for block-timing even when every row scores good', () => {
    // The tail-clipping case: lines score "good" (offTimingCount 0) yet share
    // coarse blocks, so the hint must still surface — driven by suggestAccurateAlign.
    const { onAutoAlignAccurate } = renderHint({
      lineAlignmentQuality: allGood,
      alignmentConfidence: 0.9,
      accurateRealignReason: 'segment-blocks',
    })
    expect(screen.getByText(/analyzed in coarse blocks/i)).toBeTruthy()
    const btn = screen.getByRole('button', { name: /re-align accurately/i })
    fireEvent.click(btn)
    expect(onAutoAlignAccurate).toHaveBeenCalledTimes(1)
  })

  it('mismatch takes priority over the block-timing offer', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.3, accurateRealignReason: 'segment-blocks' })
    expect(screen.getByText(/may not match this recording/i)).toBeTruthy()
    expect(screen.queryByText(/analyzed in coarse blocks/i)).toBeNull()
  })

  it('recommends a more powerful pass when many lines could not be verified (weak-labels)', () => {
    // 8 rows, 6 unverified: the song-level indicator fires with an explicit
    // "needs a more powerful pass" message and the accurate re-align CTA.
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
    expect(screen.getByText(/needs a more powerful pass/i)).toBeTruthy()
    expect(screen.getByText(/6 lines couldn.t be verified/i)).toBeTruthy()
    const btn = screen.getByRole('button', { name: /re-align accurately/i })
    fireEvent.click(btn)
    expect(onAutoAlignAccurate).toHaveBeenCalledTimes(1)
  })

  it('shows the plain off-timing nudge for a few stray rows', () => {
    renderHint({ lineAlignmentQuality: ['needs_review', 'good'], alignmentConfidence: 0.9 })
    expect(screen.getByText(/1 line off-timing/i)).toBeTruthy()
    expect(screen.queryByText(/may not match this recording/i)).toBeNull()
  })

  it('shows no hint for a healthy alignment', () => {
    renderHint({ lineAlignmentQuality: allGood, alignmentConfidence: 0.9 })
    expect(screen.queryByText(/off-timing/i)).toBeNull()
    expect(screen.queryByText(/may not match this recording/i)).toBeNull()
    expect(screen.queryByText(/analyzed in coarse blocks/i)).toBeNull()
  })
})
