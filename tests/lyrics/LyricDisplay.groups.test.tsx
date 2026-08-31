import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import type { TimedLine } from '../../src/core/types'

const setStore = (lines: TimedLine[], patch: Partial<ReturnType<typeof useLyricsStore.getState>> = {}) => {
  useLyricsStore.setState({ lines, activeLine: 0, ...patch })
}

const grouped = (original: string, translation: string, translationGroup: number): TimedLine => ({
  startTime: 0, endTime: 1, original, translation, translationGroup,
})

describe('LyricDisplay translation groups', () => {
  beforeEach(() => {
    useLyricsStore.setState({ furiganaMode: 'off', showTranslation: true, lyricsLayout: 'stacked' })
  })

  it('renders a shared translation once across a two-row group', () => {
    setStore([
      grouped('一行目', 'a merged thought', 7),
      grouped('二行目', 'a merged thought', 7),
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getAllByText('a merged thought')).toHaveLength(1)
  })

  it('still shows both original rows', () => {
    setStore([
      grouped('一行目', 'a merged thought', 7),
      grouped('二行目', 'a merged thought', 7),
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getByText('一行目')).toBeTruthy()
    expect(screen.getByText('二行目')).toBeTruthy()
  })

  it('does not bracket rows outside the group', () => {
    setStore([
      grouped('一行目', 'a merged thought', 7),
      grouped('二行目', 'a merged thought', 7),
      { startTime: 2, endTime: 3, original: '三行目', translation: 'a third thought' },
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getAllByText('a merged thought')).toHaveLength(1)
    expect(screen.getByText('a third thought')).toBeTruthy()
  })

  it('renders every row of a group independently when ungrouped (regression baseline)', () => {
    setStore([
      { startTime: 0, endTime: 1, original: '一行目', translation: 'first' },
      { startTime: 1, endTime: 2, original: '二行目', translation: 'second' },
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
  })

  it('does not merge non-contiguous rows that happen to reuse a group id', () => {
    setStore([
      grouped('一行目', 'shared', 1),
      { startTime: 1, endTime: 2, original: '中', translation: 'middle' },
      grouped('三行目', 'shared', 1),
    ])
    render(<LyricDisplay onLineClick={() => {}} />)
    // Both rows show 'shared' independently — a stale/reused id one row apart
    // must not bracket them together.
    expect(screen.getAllByText('shared')).toHaveLength(2)
  })
})
