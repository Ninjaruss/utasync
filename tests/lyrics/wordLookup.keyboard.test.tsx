import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LyricDisplay } from '../../src/lyrics/LyricDisplay'
import { useLyricsStore } from '../../src/lyrics/LyricsStore'
import { useSettingsStore } from '../../src/payment/SettingsStore'
import type { TimedLine } from '../../src/core/types'

vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return {
    ...actual,
    lookupWord: vi.fn().mockResolvedValue({
      headword: '雪', reading: 'ゆき', pos: '名詞', posLabel: 'noun',
      glosses: ['snow'], dictionaryAvailable: true,
    }),
  }
})

const LINE: TimedLine = {
  original: '雪が降る', translation: 'snow falls', startTime: 0, endTime: 4,
  tokens: [
    { surface: '雪', reading: 'ユキ', pos: '名詞', startIndex: 0, endIndex: 1 },
    { surface: 'が', reading: 'ガ', pos: '助詞', startIndex: 1, endIndex: 2 },
    { surface: '降る', reading: 'フル', pos: '動詞', startIndex: 2, endIndex: 4 },
  ],
}

beforeEach(() => {
  useSettingsStore.setState({ tapLookupEnabled: true })
  useLyricsStore.setState({
    lines: [LINE], activeLine: 0,
    furiganaMode: 'furigana', showTranslation: true, lyricsLayout: 'stacked',
  })
})

describe('word lookup from the keyboard', () => {
  it('exposes each word on the active line as a control, not inert text', () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.getByRole('button', { name: /look up 雪/i })).toBeTruthy()
  })

  // Queried by dialog role, not gloss text: the line's own translation contains
  // the word "snow" too, so a text query passes whether or not it opened.
  const popover = () => screen.queryByRole('dialog', { name: /dictionary entry for 雪/i })

  it('opens the dictionary with Enter', async () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /look up 雪/i }), { key: 'Enter' })
    await waitFor(() => expect(popover()).toBeTruthy())
  })

  it('opens the dictionary with Space', async () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /look up 雪/i }), { key: ' ' })
    await waitFor(() => expect(popover()).toBeTruthy())
  })

  it('closes the popover with Escape', async () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /look up 雪/i }))
    await waitFor(() => expect(popover()).toBeTruthy())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(popover()).toBeNull())
  })

  it('returns focus to the word after closing, not to the top of the page', async () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    const word = screen.getByRole('button', { name: /look up 雪/i })
    word.focus()
    fireEvent.keyDown(word, { key: 'Enter' })
    await waitFor(() => expect(popover()).toBeTruthy())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(word))
  })

  it('leaves non-Japanese words alone rather than offering a useless lookup', () => {
    useLyricsStore.setState({
      lines: [{
        original: 'snow falls', translation: '', startTime: 0, endTime: 4,
        tokens: [{ surface: 'snow', pos: 'noun', startIndex: 0, endIndex: 4 }],
      }],
      activeLine: 0,
    })
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /look up/i })).toBeNull()
  })

  it('does not make words controls when tap lookup is switched off', () => {
    useSettingsStore.setState({ tapLookupEnabled: false })
    render(<LyricDisplay onLineClick={() => {}} />)
    expect(screen.queryByRole('button', { name: /look up 雪/i })).toBeNull()
  })
})
