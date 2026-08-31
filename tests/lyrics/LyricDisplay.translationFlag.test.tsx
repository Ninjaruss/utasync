import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import type { TimedLine } from '../../src/core/types'

// Task 11 Step 4: the row marker is driven by STRUCTURAL FACTS (a hole in an
// otherwise-translated song, or a song-wide pairing 'mismatch'), never by
// translationConfidence — that score measured AUC 0.399 (below chance) on
// this exact population, per the controller ruling in the task brief.

const setStore = (lines: TimedLine[], patch: Partial<ReturnType<typeof useLyricsStore.getState>> = {}) => {
  useLyricsStore.setState({ lines, activeLine: 0, showTranslation: true, lyricsLayout: 'stacked', clozeMode: false, ...patch })
}

describe('LyricDisplay translation flag (structural facts)', () => {
  beforeEach(() => {
    useLyricsStore.setState({ furiganaMode: 'furigana', showTranslation: true, lyricsLayout: 'stacked', clozeMode: false })
  })

  it('flags a hole row (no translation) when the song otherwise has translations', () => {
    setStore([
      { original: 'line one', startTime: 0, endTime: 1, translation: 'first line' },
      { original: 'line two', startTime: 1, endTime: 2, translation: '' },
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getByRole('button', { name: /translation missing for line 2/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /translation missing for line 1/i })).toBeNull()
  })

  it('does not flag anything on a song with no translations at all', () => {
    setStore([
      { original: 'line one', startTime: 0, endTime: 1, translation: '' },
      { original: 'line two', startTime: 1, endTime: 2, translation: '' },
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /translation missing/i })).toBeNull()
  })

  it('does not flag a fully-translated song with no mismatch and no unplaced lines', () => {
    setStore([
      { original: 'line one', startTime: 0, endTime: 1, translation: 'first line' },
      { original: 'line two', startTime: 1, endTime: 2, translation: 'second line' },
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /translation missing/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /check this translation/i })).toBeNull()
  })

  it('flags every translated row when the pairing method was mismatch', () => {
    setStore([
      { original: 'line one', startTime: 0, endTime: 1, translation: 'first line' },
      { original: 'line two', startTime: 1, endTime: 2, translation: 'second line' },
    ])
    render(<LyricDisplay onLineClick={() => {}} translationMismatch />)
    expect(screen.getByRole('button', { name: /check translation for line 1/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /check translation for line 2/i })).toBeTruthy()
  })

  it('never flags from translationConfidence alone', () => {
    // Both rows have a (low) confidence score but a real, fully-fitted
    // translation with no mismatch and nothing unplaced — must not be flagged.
    setStore([
      { original: 'line one', startTime: 0, endTime: 1, translation: 'first line', translationConfidence: 0.05 },
      { original: 'line two', startTime: 1, endTime: 2, translation: 'second line', translationConfidence: 0.02 },
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /translation missing/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /check this translation/i })).toBeNull()
  })

  it('tapping a flagged row opens the repair popover without seeking playback', async () => {
    const onLineClick = vi.fn()
    const onFetchRepairCandidates = vi.fn().mockResolvedValue([
      { text: 'better fit', score: 0.9, source: 'nearby' as const },
    ])
    setStore([
      { original: 'line one', startTime: 0, endTime: 1, translation: 'first line' },
      { original: 'line two', startTime: 1, endTime: 2, translation: '' },
    ])
    render(
      <LyricDisplay
        onLineClick={onLineClick}
        onFetchRepairCandidates={onFetchRepairCandidates}
        onChooseRepair={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /translation missing for line 2/i }))
    expect(onLineClick).not.toHaveBeenCalled()
    expect(onFetchRepairCandidates).toHaveBeenCalledWith(1)
    expect(await screen.findByText('better fit')).toBeTruthy()
  })

  it('surfaces unplaced translation lines as a quiet, collapsible note', () => {
    setStore([
      { original: 'line one', startTime: 0, endTime: 1, translation: 'first line' },
      { original: 'line two', startTime: 1, endTime: 2, translation: 'second line' },
    ])
    render(
      <LyricDisplay
        onLineClick={() => {}}
        unplacedTranslations={[{ text: 'orphaned translation', afterLineIndex: 1 }]}
      />,
    )
    expect(screen.queryByText('orphaned translation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /1 line weren't placed/i }))
    expect(screen.getByText('orphaned translation')).toBeTruthy()
  })
})
