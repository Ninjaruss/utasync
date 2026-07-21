import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMode } from '../../src/lyrics/EditMode'
import type { TimedLine } from '../../src/core/types'

const required = () => ({
  lines: [{ original: 'a', translation: '', startTime: 0, endTime: 2 }] as TimedLine[],
  playhead: () => 0, playheadPosition: 0, seek: vi.fn(), onScrubStart: vi.fn(), onScrubEnd: vi.fn(),
  hasLocalAudio: true, title: 'T', artist: 'A', sourceLanguage: 'ja' as const,
  onChangeLines: vi.fn(), onAutoAlign: vi.fn(),
})
// Props that make alignmentHint === 'weak-labels' fire: hasLocalAudio (from
// `required`) + accurateRealignReason === 'weak-labels' + showAlignmentQuality,
// with likelyLyricsMismatch false (offTimingLineCount(1) < MISMATCH_MIN_OFF_LINES
// of 4, so a single needs_review row never trips the mismatch branch).
const weak = { accurateRealignReason: 'weak-labels' as const, showAlignmentQuality: true, lineAlignmentQuality: ['needs_review' as const] }

describe('EditMode "Isolate vocals" nudge', () => {
  it('shows the nudge when weak, separation NOT used, and supported', () => {
    const onAutoAlignWithVocals = vi.fn()
    render(<EditMode {...required()} {...weak} vocalSeparationUsed={false} vocalSeparationSupported onAutoAlignWithVocals={onAutoAlignWithVocals} />)
    const btn = screen.getByRole('button', { name: /isolate vocals/i })
    fireEvent.click(btn)
    expect(onAutoAlignWithVocals).toHaveBeenCalledTimes(1)
  })
  it('does NOT show when vocals were already isolated', () => {
    render(<EditMode {...required()} {...weak} vocalSeparationUsed vocalSeparationSupported onAutoAlignWithVocals={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /isolate vocals/i })).toBeNull()
  })
  it('does NOT show when separation is unsupported', () => {
    render(<EditMode {...required()} {...weak} vocalSeparationUsed={false} vocalSeparationSupported={false} onAutoAlignWithVocals={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /isolate vocals/i })).toBeNull()
  })
  it('does NOT show when there is no weak/off-timing hint', () => {
    render(<EditMode {...required()} vocalSeparationUsed={false} vocalSeparationSupported onAutoAlignWithVocals={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /isolate vocals/i })).toBeNull()
  })
})
