import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { useSettingsStore } from '../../src/payment/SettingsStore'
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

  it('does not repeat token surfaces on the active line', () => {
    setStore([
      {
        original: '君',
        startTime: 0,
        endTime: 2,
        translation: 'you',
        tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
      },
    ], { lyricsLayout: 'sideBySide', activeLine: 0 })
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getAllByText('君')).toHaveLength(1)
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
    expect(container.querySelectorAll('[class*="grid-cols-2"]')).toHaveLength(1)
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
    useSettingsStore.setState({ readingMode: 'dictionary' })
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

  it('colors matched word pairs in stacked layout when translation is shown', () => {
    useLyricsStore.setState({ lyricsLayout: 'stacked', showTranslation: true, lines: [coloredLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const sourceSpan = screen.getByText('君')
    const targetSpan = screen.getByText('you')
    expect(sourceSpan.style.borderBottomColor).not.toBe('')
    expect(sourceSpan.style.borderBottomColor).toBe(targetSpan.style.borderBottomColor)
  })

  it('shows no coloring when translation is hidden in stacked layout', () => {
    useLyricsStore.setState({ lyricsLayout: 'stacked', showTranslation: false, lines: [coloredLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    expect(screen.getByText('君').style.borderBottomColor).toBe('')
  })

  it('colors Japanese tokens in furigana mode (the default for ja)', () => {
    const line: TimedLine = {
      ...coloredLine,
      furigana: '<ruby>君<rt>きみ</rt></ruby>',
      tokens: [{ surface: '君', reading: 'キミ', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
    }
    useLyricsStore.setState({ furiganaMode: 'furigana', lines: [line], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const sourceSpan = screen.getByText('君').closest('span')!
    const targetSpan = screen.getByText('you')
    expect(sourceSpan.style.borderBottomColor).not.toBe('')
    expect(sourceSpan.style.borderBottomColor).toBe(targetSpan.style.borderBottomColor)
    expect(screen.getByText('きみ')).toBeTruthy()
  })

  it('keeps the dictionary reading in the ruby for a low-confidence sung alternate (戦争 fix)', () => {
    const line: TimedLine = {
      startTime: 0,
      endTime: 2,
      original: '戦争',
      translation: '',
      tokens: [
        // Noisy segment-mode alternate: present but below the ruby threshold.
        { surface: '戦争', reading: 'センソウ', audioReading: 'ソレ', readingConfidence: 0.35, pos: '名詞', startIndex: 0, endIndex: 2 },
      ],
    }
    useLyricsStore.setState({ furiganaMode: 'furigana', lines: [line], activeLine: 0 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    // Dictionary reading wins the ruby; the sung form is not promoted.
    expect(screen.getByText('せんそう')).toBeTruthy()
    expect(screen.queryByText('それ')).toBeNull()
    expect(document.querySelector('ruby.reading-audio')).toBeNull()
    // The sung alternate is still surfaced in the tooltip.
    expect(document.querySelector('ruby')?.getAttribute('title')).toContain('それ')
  })

  it('keeps the dictionary reading in the ruby by default, sung alternate in the tooltip', () => {
    const line: TimedLine = {
      startTime: 0,
      endTime: 2,
      original: '理由色',
      translation: '',
      tokens: [
        { surface: '理由', reading: 'リユウ', audioReading: 'ワケ', readingConfidence: 0.85, pos: '名詞', startIndex: 0, endIndex: 2 },
        { surface: '色', reading: 'イロ', readingMismatch: true, pos: '名詞', startIndex: 2, endIndex: 3 },
      ],
    }
    useLyricsStore.setState({ furiganaMode: 'furigana', lines: [line], activeLine: 0 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    // Even a high-confidence sung alternate stays out of the ruby in dictionary mode.
    expect(screen.getByText('りゆう')).toBeTruthy()
    expect(screen.queryByText('わけ')).toBeNull()
    expect(document.querySelector('ruby')?.getAttribute('title')).toContain('わけ')
  })

  it('promotes a low-confidence sung alternate into the ruby when readingMode is sung', () => {
    useSettingsStore.setState({ readingMode: 'sung' })
    const line: TimedLine = {
      startTime: 0,
      endTime: 2,
      original: '明日',
      translation: '',
      tokens: [
        { surface: '明日', reading: 'アシタ', audioReading: 'アス', readingConfidence: 0.4, pos: '名詞', startIndex: 0, endIndex: 2 },
      ],
    }
    useLyricsStore.setState({ furiganaMode: 'furigana', lines: [line], activeLine: 0 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    expect(screen.getByText('あす')).toBeTruthy()
    expect(document.querySelector('ruby.reading-audio')).toBeTruthy()
  })

  it('highlights a matched word pair on hover in side-by-side mode', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    useLyricsStore.setState({ lines: [coloredLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const sourceSpan = screen.getByText('君').closest('span')!
    const targetSpan = screen.getByText('you')
    expect(sourceSpan.style.backgroundColor).toBe('')
    await user.hover(sourceSpan)
    expect(sourceSpan.style.backgroundColor).toBe('rgba(255, 255, 255, 0.1)')
    expect(targetSpan.style.backgroundColor).toBe('rgba(255, 255, 255, 0.1)')
  })

  it('colors matched word pairs across newline-separated translation lines', () => {
    const line: TimedLine = {
      startTime: 0,
      endTime: 2,
      original: '滑り込むキミの横 隣り合わせのハート',
      translation: 'Beside you\nAdjacent hearts',
      tokens: [
        { surface: 'キミ', pos: '名詞', startIndex: 5, endIndex: 7, alignmentIndices: [1] },
        { surface: '横', pos: '名詞', startIndex: 8, endIndex: 9, alignmentIndices: [0] },
        { surface: 'ハート', pos: '名詞', startIndex: 16, endIndex: 19, alignmentIndices: [3] },
      ],
    }
    useLyricsStore.setState({ lines: [line], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const kimi = screen.getByText('キミ')
    const beside = screen.getByText('Beside')
    const hearts = screen.getByText('hearts')
    expect(beside.style.borderBottomColor).not.toBe('')
    expect(hearts.style.borderBottomColor).not.toBe('')
    expect(kimi.style.borderBottomColor).toBe(screen.getByText('you').style.borderBottomColor)
    expect(beside.style.borderBottomColor).toBe(
      screen.getByText('横').style.borderBottomColor,
    )
  })

  it('marks sung Japanese for dictionary extensions with lang="ja"', () => {
    useLyricsStore.setState({
      lines: [{ startTime: 0, endTime: 2, original: '君', translation: 'you' }],
      activeLine: -1,
      lyricsLayout: 'sideBySide',
    })
    const { container } = render(<LyricDisplay onLineClick={vi.fn()} />)
    expect(container.querySelector('[lang="ja"].yomitan-text')).toBeTruthy()
  })

  it('colors Japanese tokens on mixed-script lines against the second translation line', () => {
    const original = 'You always make me so happy 青空に溶けて'
    const translation = 'You always make me so happy\nMelt into the blue sky'
    const jaStart = original.indexOf('青空')
    const line: TimedLine = {
      startTime: 0,
      endTime: 2,
      original,
      translation,
      tokens: [
        { surface: '青空', pos: '名詞', reading: 'アオゾラ', startIndex: jaStart, endIndex: jaStart + 2, alignmentIndices: [10] },
        { surface: '溶け', pos: '動詞', reading: 'トケ', startIndex: jaStart + 3, endIndex: jaStart + 5, alignmentIndices: [6] },
      ],
    }
    useLyricsStore.setState({ lines: [line], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const aozora = screen.getByText('青空').closest('span')!
    const toke = screen.getByText('溶け').closest('span')!
    const melt = screen.getByText('Melt')
    const sky = screen.getByText('sky')
    const soWord = screen.getByText('so')
    const youWord = screen.getByText('You')
    expect(aozora.style.borderBottomColor).toBe(sky.style.borderBottomColor)
    expect(toke.style.borderBottomColor).toBe(melt.style.borderBottomColor)
    expect(soWord.style.borderBottomColor).toBe('')
    expect(youWord.style.borderBottomColor).toBe('')
  })

  it('colors both sides when alignment skips English function words', () => {
    const original = '一歩だけ遅れてる いつも通りのあたし'
    const translation = "Only one step behind\nI'm the same as always"
    const words = ['Only', 'one', 'step', 'behind', "I'm", 'the', 'same', 'as', 'always']
    const line: TimedLine = {
      startTime: 0,
      endTime: 2,
      original,
      translation,
      tokens: [
        { surface: 'だけ', pos: '助詞', startIndex: 2, endIndex: 4, alignmentIndices: [words.indexOf('Only')] },
        { surface: '遅れ', pos: '動詞', startIndex: 4, endIndex: 6, alignmentIndices: [words.indexOf('behind')] },
        { surface: 'いつも', pos: '名詞', startIndex: 9, endIndex: 12, alignmentIndices: [words.indexOf('always')] },
        { surface: 'あたし', pos: '名詞', startIndex: 15, endIndex: 18, alignmentIndices: [words.indexOf("I'm")] },
      ],
    }
    useLyricsStore.setState({ lines: [line], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const only = screen.getByText('Only')
    const behind = screen.getByText('behind')
    const always = screen.getByText('always')
    const im = screen.getByText("I'm")
    const dake = screen.getByText('だけ')
    expect(dake.style.borderBottomColor).toBe(only.style.borderBottomColor)
    expect(screen.getByText('遅れ').style.borderBottomColor).toBe(behind.style.borderBottomColor)
    expect(screen.getByText('いつも').style.borderBottomColor).toBe(always.style.borderBottomColor)
    expect(screen.getByText('あたし').style.borderBottomColor).toBe(im.style.borderBottomColor)
    expect(screen.getByText('the').style.borderBottomColor).toBe('')
  })

  it('highlights a matched word pair on hover in stacked layout', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    useLyricsStore.setState({ lyricsLayout: 'stacked', showTranslation: true, lines: [coloredLine], activeLine: -1 })
    render(<LyricDisplay onLineClick={vi.fn()} />)
    const sourceSpan = screen.getByText('君').closest('span')!
    const targetSpan = screen.getByText('you')
    await user.hover(targetSpan)
    expect(sourceSpan.style.backgroundColor).toBe('rgba(255, 255, 255, 0.1)')
    expect(targetSpan.style.backgroundColor).toBe('rgba(255, 255, 255, 0.1)')
  })
})

describe('A-B loop region highlight', () => {
  it('marks lines inside an active loop window', () => {
    const loopLines: TimedLine[] = [
      { startTime: 0, endTime: 2, original: 'in', translation: '' },
      { startTime: 2, endTime: 5, original: 'out', translation: '' },
    ]
    useLyricsStore.setState({ lines: loopLines, activeLine: -1 })
    const { container } = render(
      <LyricDisplay
        onLineClick={vi.fn()}
        abLoop={{ a: 0, b: 2.5, preRoll: 2, loopCount: 3, crossfadeDuration: 0.3 }}
      />,
    )
    const inLoop = container.querySelector('[class*="border-l-2"]')
    expect(inLoop?.textContent).toMatch(/in/)
    expect(container.textContent).toMatch(/out/)
  })

  it('highlights every saved playlist segment while the playlist is active', () => {
    const loopLines: TimedLine[] = [
      { startTime: 0, endTime: 2, original: 'seg-a', translation: '' },
      { startTime: 3, endTime: 4, original: 'between', translation: '' },
      { startTime: 5, endTime: 8, original: 'seg-b', translation: '' },
    ]
    useLyricsStore.setState({ lines: loopLines, activeLine: -1 })
    const { container } = render(
      <LyricDisplay
        onLineClick={vi.fn()}
        abLoop={{ a: 0, b: 2.5, preRoll: 0, loopCount: 3, crossfadeDuration: 0.3 }}
        playlistActive
        playlistIndex={0}
        playlistEntries={[
          { id: '1', a: 0, b: 2.5 },
          { id: '2', a: 5, b: 7.5 },
        ]}
      />,
    )
    const highlighted = container.querySelectorAll('[class*="border-l-2"]')
    expect(highlighted.length).toBe(2)
    expect(highlighted[0]?.textContent).toMatch(/seg-a/)
    expect(highlighted[1]?.textContent).toMatch(/seg-b/)
  })
})
