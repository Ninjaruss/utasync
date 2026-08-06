import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { useSettingsStore } from '../../src/payment/SettingsStore'
import type { TimedLine } from '../../src/core/types'

vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return { ...actual, lookupWord: vi.fn().mockResolvedValue({ headword: '雪', reading: 'ゆき', pos: '名詞', glosses: ['snow'], dictionaryAvailable: true }) }
})

const LINES: TimedLine[] = [
  { original: '雪が降る', translation: 'snow falls', startTime: 0, endTime: 4, tokens: [{ surface: '雪', reading: 'ユキ', pos: '名詞', startIndex: 0, endIndex: 1 }] },
  { original: '君の声', translation: 'your voice', startTime: 5, endTime: 9 },
  { original: '遠く', translation: 'far away', startTime: 10, endTime: 14 },
]

beforeEach(() => {
  useSettingsStore.setState({ tapLookupEnabled: true })
  useLyricsStore.setState({
    lines: LINES, activeLine: 0,
    furiganaMode: 'none', showTranslation: true, lyricsLayout: 'stacked',
  })
})

describe('seeking a lyric line from the keyboard', () => {
  it('exposes non-active lines as controls that say where they go', () => {
    render(<LyricDisplay onLineClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /jump to 君の声/i })).toBeTruthy()
  })

  it('seeks on Enter', () => {
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /jump to 君の声/i }), { key: 'Enter' })
    expect(onLineClick).toHaveBeenCalledWith(LINES[1])
  })

  it('seeks on Space', () => {
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /jump to 遠く/i }), { key: ' ' })
    expect(onLineClick).toHaveBeenCalledWith(LINES[2])
  })

  // The active line's words are themselves controls, so making the row a
  // control too would nest one inside the other. You are already on that line,
  // so there is nothing to seek to.
  it('does not make the active line a control while its words are', () => {
    render(<LyricDisplay onLineClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /look up 雪/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /jump to 雪が降る/i })).toBeNull()
  })
})

describe('placing an A–B loop point from a lyric line', () => {
  it('makes every line a control while a loop point is being armed', () => {
    render(<LyricDisplay onLineClick={vi.fn()} armingAB="a" />)
    expect(screen.getByRole('button', { name: /set loop point a at 雪が降る/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /set loop point a at 君の声/i })).toBeTruthy()
  })

  it('names the point being placed, so A and B are not guesswork', () => {
    render(<LyricDisplay onLineClick={vi.fn()} armingAB="b" />)
    expect(screen.getByRole('button', { name: /set loop point b at 君の声/i })).toBeTruthy()
  })

  // Regression: with the dictionary live, tapping the active line's Japanese
  // opened a definition instead of placing the point the user had just armed.
  it('suspends word lookup while arming, so the tap places the point', () => {
    render(<LyricDisplay onLineClick={vi.fn()} armingAB="a" />)
    expect(screen.queryByRole('button', { name: /look up 雪/i })).toBeNull()
  })

  it('places the point on Enter', () => {
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} armingAB="a" />)
    fireEvent.keyDown(screen.getByRole('button', { name: /set loop point a at 雪が降る/i }), { key: 'Enter' })
    expect(onLineClick).toHaveBeenCalledWith(LINES[0])
  })
})
