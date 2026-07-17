import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { useSettingsStore } from '../../src/payment/SettingsStore'
import type { TimedLine } from '../../src/core/types'

vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return {
    ...actual,
    lookupWord: vi.fn().mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true }),
  }
})

vi.mock('../../src/language/english/wordLookupEn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/english/wordLookupEn')>()
  return { ...actual, lookupEnglishWord: vi.fn().mockResolvedValue({ headword: 'spring', definitionLang: 'ja', equivalents: [{ ja: '春', reading: 'はる' }], definitions: [], dictionaryAvailable: true }) }
})

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

  it('promotes a high-confidence sung alternate into the ruby by default, dictionary in the tooltip', () => {
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
    // A high-confidence sung alternate owns the ruby even in dictionary mode.
    expect(screen.getByText('わけ')).toBeTruthy()
    expect(screen.queryByText('りゆう')).toBeNull()
    expect(document.querySelector('ruby')?.getAttribute('title')).toContain('りゆう')
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

describe('tap-to-look-up wiring', () => {
  const tokenLine: TimedLine = {
    original: '躱し', startTime: 0, endTime: 2, translation: '',
    tokens: [{ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す', startIndex: 0, endIndex: 2 }],
  }

  beforeEach(() => {
    useLyricsStore.setState({ lines: [tokenLine], activeLine: 0, furiganaMode: 'none', showTranslation: false, lyricsLayout: 'stacked' })
    useSettingsStore.setState({ tapLookupEnabled: true, readingMode: 'dictionary' })
  })

  it('opens the popover on token tap without seeking the line', async () => {
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('躱し'))
    expect(onLineClick).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(await screen.findByText('to dodge')).toBeTruthy()
  })

  it('keeps plain rendering and line seek for English token-bearing lines', () => {
    useLyricsStore.setState({
      lines: [{
        original: 'Hello world', startTime: 0, endTime: 2, translation: '',
        tokens: [
          { surface: 'Hello', startIndex: 0, endIndex: 5 },
          { surface: 'world', startIndex: 6, endIndex: 11 },
        ],
      }],
      activeLine: 0,
      furiganaMode: 'none',
      showTranslation: false,
    })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    const lineText = screen.getByText('Hello world')
    fireEvent.click(lineText)
    expect(onLineClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('seeks the line instead of opening a popover for punctuation tokens', () => {
    useLyricsStore.setState({
      lines: [{
        original: '躱し、', startTime: 0, endTime: 2, translation: '',
        tokens: [
          { surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す', startIndex: 0, endIndex: 2 },
          { surface: '、', pos: '記号', startIndex: 2, endIndex: 3 },
        ],
      }],
      activeLine: 0,
    })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('、'))
    expect(onLineClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not intercept taps when the setting is off', () => {
    useSettingsStore.setState({ tapLookupEnabled: false })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('躱し'))
    expect(onLineClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not open the popover for a word on a non-active line; it seeks instead', () => {
    useLyricsStore.setState({
      lines: [
        { original: '一行目', startTime: 0, endTime: 2, translation: '',
          tokens: [{ surface: '一行目', reading: 'イチギョウメ', pos: '名詞', startIndex: 0, endIndex: 3 }] },
        { original: '躱し', startTime: 2, endTime: 4, translation: '',
          tokens: [{ surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す', startIndex: 0, endIndex: 2 }] },
      ],
      activeLine: 0, furiganaMode: 'none', showTranslation: false, lyricsLayout: 'stacked',
    })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('躱し')) // word on the NON-active (second) line
    expect(onLineClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('English tap-to-look-up wiring', () => {
  const enLine = (activeLine: number) => ({
    lines: [{
      original: '君', startTime: 0, endTime: 2, translation: 'you spring',
      tokens: [{ surface: '君', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }],
    }],
    activeLine,
  })

  beforeEach(() => {
    useLyricsStore.setState({ furiganaMode: 'none', showTranslation: true, lyricsLayout: 'stacked' })
    useSettingsStore.setState({ tapLookupEnabled: true, readingMode: 'dictionary' })
  })

  it('opens the English popover when a translation word on the active line is tapped', async () => {
    useLyricsStore.setState(enLine(0))
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('spring'))
    expect(onLineClick).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('does not open the English popover for a translation word on a non-active line', () => {
    useLyricsStore.setState({
      lines: [
        { original: '一', startTime: 0, endTime: 2, translation: 'one', tokens: [{ surface: '一', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }] },
        { original: '二', startTime: 2, endTime: 4, translation: 'two', tokens: [{ surface: '二', pos: '名詞', startIndex: 0, endIndex: 1, alignmentIndices: [0] }] },
      ],
      activeLine: 0,
    })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} />)
    fireEvent.click(screen.getByText('two')) // translation word on the non-active line
    expect(onLineClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('LyricDisplay active-line centering', () => {
  const twoLines: TimedLine[] = [
    { original: 'line one', startTime: 0, endTime: 2, translation: '' },
    { original: 'line two', startTime: 2, endTime: 4, translation: '' },
  ]

  it('jumps instantly on mount, then scrolls smoothly as the line advances', async () => {
    const { act } = await import('@testing-library/react')
    const original = window.HTMLElement.prototype.scrollIntoView
    const calls: unknown[] = []
    window.HTMLElement.prototype.scrollIntoView = function (opts?: unknown) {
      calls.push(opts)
    }
    try {
      setStore(twoLines, { activeLine: 0 })
      render(<LyricDisplay onLineClick={() => {}} />)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ block: 'center', behavior: 'auto' })
      act(() => {
        useLyricsStore.setState({ activeLine: 1 })
      })
      expect(calls).toHaveLength(2)
      expect(calls[1]).toMatchObject({ block: 'center', behavior: 'smooth' })
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original
    }
  })
})
