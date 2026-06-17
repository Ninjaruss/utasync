import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import type { TimedLine } from '../../src/core/types'

const setStore = (lines: TimedLine[], patch: Partial<ReturnType<typeof useLyricsStore.getState>> = {}) => {
  useLyricsStore.setState({ lines, activeLine: 0, ...patch })
}

describe('LyricDisplay dedup', () => {
  beforeEach(() => {
    useLyricsStore.setState({ furiganaMode: 'romaji', showTranslation: true, lyricsLayout: 'stacked' })
  })

  it('hides romaji that merely repeats the original', () => {
    setStore([{ original: 'Hello', startTime: 0, endTime: 1, translation: '', reading: 'hello' }])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getAllByText('Hello')).toHaveLength(1)
  })

  it('keeps romaji that differs from the original', () => {
    setStore([{ original: '君の瞳', startTime: 0, endTime: 1, translation: '', reading: 'kimi no hitomi' }])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getByText('kimi no hitomi')).toBeTruthy()
  })

  it('hides a translation that repeats the original', () => {
    setStore([{ original: 'Hello', startTime: 0, endTime: 1, translation: 'hello' }])
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getAllByText(/hello/i)).toHaveLength(1)
  })

  it('falls back to stacked layout in sideBySide mode when the translation duplicates the original, but keeps the grid when it differs', () => {
    setStore(
      [
        { original: 'Hello', startTime: 0, endTime: 1, translation: 'hello' },
        { original: 'こんにちは', startTime: 1, endTime: 2, translation: 'Hello' },
      ],
      { lyricsLayout: 'sideBySide' }
    )
    const { container } = render(<LyricDisplay onLineClick={() => {}} />)
    expect(container.querySelectorAll('.grid-cols-2')).toHaveLength(1)
  })
})
