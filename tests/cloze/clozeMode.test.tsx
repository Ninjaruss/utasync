import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { useSettingsStore } from '../../src/settings/SettingsStore'
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

/** The rendered second language, joined — it is split into per-word spans when
 * word-pair colouring is on, so a plain text query cannot see a whole sentence. */
const translationText = () =>
  [...document.querySelectorAll('div[lang="en"]')].map((el) => el.textContent ?? '').join(' | ')

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

  // The word is hidden by colour alone, so it has to leave the accessibility tree
  // and the selection buffer as well — otherwise a screen reader reads out the
  // answer, and a long-press or drag-select offers Copy / Look Up on it.
  it('keeps the hidden word out of the accessibility tree and out of a selection', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)

    const blanks = [...document.querySelectorAll('.text-transparent')] as HTMLElement[]
    expect(blanks.length).toBeGreaterThan(0)
    for (const blank of blanks) {
      expect(blank.getAttribute('aria-hidden')).toBe('true')
      // Inline, because `.yomitan-text` sets user-select: text at the same
      // specificity and a utility class would lose on source order.
      expect(blank.style.userSelect).toBe('none')
    }
    // …and the drill still says something is missing, so it is usable without sight.
    expect(screen.getByText(/2 words are hidden\. Reveal to see them\./i)).toBeTruthy()
  })

  it('says nothing about hidden words once the row is revealed', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))
    expect(screen.queryByText(/words are hidden/i)).toBeNull()
  })

  // LyricDisplay is reused across songs (App swaps songId rather than
  // remounting), and `lines` is replaced on load. A bare line INDEX would then
  // reveal whichever row sat at that position in the new song — answer on
  // screen, no Reveal control, drill silently over.
  it('re-blanks when the lyrics are replaced by another song', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))
    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull()

    act(() => {
      useLyricsStore.setState({
        lines: [{ original: '別の歌', translation: 'another song', startTime: 0, endTime: 3, tokens }],
        activeLine: 0,
      })
    })

    expect(screen.getByRole('button', { name: /reveal/i })).toBeTruthy()
    expect(document.querySelectorAll('.text-transparent')).toHaveLength(2)
  })

  // …but an enrichment pass over the SAME lines must not wipe the reveal: the
  // row keeps its text and its start time, so it is still the row being drilled.
  it('keeps the reveal when the same line is re-enriched', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))

    act(() => {
      useLyricsStore.setState({ lines: LINES.map((l) => ({ ...l, furigana: '<ruby>x</ruby>' })) })
    })

    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull()
    expect(document.querySelectorAll('.text-transparent')).toHaveLength(0)
  })

  it('re-blanks when the drill is switched off and on again', () => {
    useLyricsStore.setState({ clozeMode: true })
    const { rerender } = render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))

    act(() => { useLyricsStore.setState({ clozeMode: false }) })
    rerender(<LyricDisplay onLineClick={() => {}} />)
    act(() => { useLyricsStore.setState({ clozeMode: true }) })
    rerender(<LyricDisplay onLineClick={() => {}} />)

    expect(screen.getByRole('button', { name: /reveal/i })).toBeTruthy()
    expect(document.querySelectorAll('.text-transparent')).toHaveLength(2)
  })

  // Word lookup stands down during a drill for exactly this reason, and the
  // second language is the same kind of giveaway: Reveal would reveal nothing.
  it('hides the translation until the answer is revealed', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)

    expect(translationText()).not.toContain('snow falls')
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))
    expect(translationText()).toContain('snow falls')
  })

  it('leaves other rows\u2019 translations alone', () => {
    useLyricsStore.setState({ clozeMode: true })
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(translationText()).toContain('your voice')
  })

  // The row itself treats Enter/Space as "seek here" — and as "place the loop
  // point" while one is being armed — so a keyboard Reveal used to do both.
  it('does not seek the row when Reveal is activated by keyboard', () => {
    useLyricsStore.setState({ clozeMode: true })
    const onLineClick = vi.fn()
    render(<LyricDisplay onLineClick={onLineClick} armingAB="a" />)

    fireEvent.keyDown(screen.getByRole('button', { name: /reveal/i }), { key: 'Enter' })
    expect(onLineClick).not.toHaveBeenCalled()

    // The row's own shortcut still works — only the button is exempt.
    fireEvent.keyDown(screen.getAllByRole('button', { name: /set loop point a/i })[0], { key: 'Enter' })
    expect(onLineClick).toHaveBeenCalledTimes(1)
  })

  it('offers no drill on a line with nothing to hide', () => {
    useLyricsStore.setState({
      clozeMode: true,
      lines: [{
        original: '、は',
        translation: '',
        startTime: 0,
        endTime: 2,
        tokens: [
          { surface: '、', pos: '記号', startIndex: 0, endIndex: 1 },
          { surface: 'は', pos: '助詞', startIndex: 1, endIndex: 2 },
        ],
      }],
      activeLine: 0,
    })
    render(<LyricDisplay onLineClick={() => {}} />)

    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull()
    expect(document.querySelectorAll('.text-transparent')).toHaveLength(0)
  })
})
