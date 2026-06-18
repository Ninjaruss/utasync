import { describe, it, expect, beforeEach, vi } from 'vitest'
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

describe('word-pair coloring', () => {
  const coloredLine: TimedLine = {
    startTime: 0, endTime: 2, original: '君', translation: 'you',
    tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
  }
  const particleLine: TimedLine = {
    startTime: 0, endTime: 2, original: 'が', translation: 'placeholder',
    tokens: [{ surface: 'が', pos: '助詞', startIndex: 0, endIndex: 1 }],
  }

  beforeEach(() => {
    useLyricsStore.setState({ lyricsLayout: 'sideBySide' })
  })

  it('colors a matched token and its translation word the same in side-by-side mode', () => {
    useLyricsStore.setState({ lines: [coloredLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const sourceSpan = screen.getByText('君')
    const targetSpan = screen.getByText('you')
    expect(sourceSpan.style.borderBottomColor).not.toBe('')
    expect(sourceSpan.style.borderBottomColor).toBe(targetSpan.style.borderBottomColor)
  })

  it('gives a particle the fixed particle color regardless of match state', () => {
    useLyricsStore.setState({ lines: [particleLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const span = screen.getByText('が')
    expect(span.style.borderBottomColor).toBe('rgb(156, 163, 175)') // PARTICLE_COLOR #9ca3af
  })

  it('shows no coloring in stacked layout', () => {
    useLyricsStore.setState({ lyricsLayout: 'stacked', lines: [coloredLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    expect(screen.getByText('君').style.borderBottomColor).toBe('')
  })
})
