import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { useSettingsStore } from '../../src/payment/SettingsStore'
import type { TimedLine } from '../../src/core/types'

vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return { ...actual, lookupWord: vi.fn().mockResolvedValue({ headword: '雪', reading: 'ゆき', pos: '名詞', glosses: ['snow'], dictionaryAvailable: true }) }
})

const tokens = [
  { surface: '雪', reading: 'ユキ', pos: '名詞', startIndex: 0, endIndex: 1 },
  { surface: 'が', reading: 'ガ', pos: '助詞', startIndex: 1, endIndex: 2 },
  { surface: '降る', reading: 'フル', pos: '動詞', startIndex: 2, endIndex: 4 },
]

const LINES: TimedLine[] = [
  { original: '雪が降る', translation: 'snow falls', startTime: 0, endTime: 4, tokens },
  { original: '君の声', translation: 'your voice', startTime: 5, endTime: 9, tokens },
]

beforeEach(() => {
  useSettingsStore.setState({ tapLookupEnabled: true })
  useLyricsStore.setState({
    lines: LINES, activeLine: 0,
    furiganaMode: 'furigana', showTranslation: true, lyricsLayout: 'stacked',
    clozeMode: false, clozeDifficulty: 'easy',
  })
})

const setActive = (i: number) => act(() => { useLyricsStore.setState({ activeLine: i }) })

describe('cloze drilling', () => {
  it('leaves the lyrics alone until the drill is switched on', () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull()
  })

  it('blanks the content words and leaves the grammar visible', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)

    const blanked = [...document.querySelectorAll('.text-transparent')].map((el) => el.textContent)
    // 'easy' blanks nouns and verbs — the scaffolding you'd read around them stays.
    expect(blanked).toContain('雪')
    expect(blanked).toContain('降る')
    expect(blanked).not.toContain('が')
  })

  it('drills only the active line, not the whole song', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getAllByRole('button', { name: /reveal/i })).toHaveLength(1)
  })

  it('reveals on request', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))
    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull()
    expect(document.querySelectorAll('.text-transparent')).toHaveLength(0)
  })

  // Revealing is per line — moving on has to re-blank, or the drill stops after
  // the first answer.
  it('re-blanks when the song moves to the next line', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))

    setActive(1)
    expect(screen.getByRole('button', { name: /reveal/i })).toBeTruthy()
  })

  it('suspends word lookup, which would otherwise hand over the answer', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /look up/i })).toBeNull()
  })

  it('restores normal lyrics when switched off', () => {
    useLyricsStore.setState({ clozeMode: true })
    const { rerender } = render(<LyricDisplay onLineClick={() => {}} />)
    act(() => { useLyricsStore.setState({ clozeMode: false }) })
    rerender(<LyricDisplay onLineClick={() => {}} />)

    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull()
    expect(screen.getByRole('button', { name: /look up 雪/i })).toBeTruthy()
  })
})
