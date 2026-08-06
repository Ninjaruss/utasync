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
      headword: '会う', reading: 'あう', pos: '動詞', posLabel: 'verb',
      glosses: ['to meet'], dictionaryAvailable: true,
    }),
  }
})

const LINE: TimedLine = {
  original: '会ったことがある', translation: 'I have met them', startTime: 0, endTime: 4,
  tokens: [
    { surface: '会っ', reading: 'アッ', pos: '動詞', startIndex: 0, endIndex: 2 },
    { surface: 'た', reading: 'タ', pos: '助動詞', startIndex: 2, endIndex: 3 },
    { surface: 'こと', reading: 'コト', pos: '名詞', startIndex: 3, endIndex: 5 },
  ],
  grammarAnnotations: [
    { tokenIndices: [1, 2], pattern: '〜たことがある', explanation: 'Have experience of doing (experiential perfect)' },
  ],
}

beforeEach(() => {
  useSettingsStore.setState({ tapLookupEnabled: true })
  useLyricsStore.setState({
    lines: [LINE], activeLine: 0,
    furiganaMode: 'none', showTranslation: true, lyricsLayout: 'stacked',
  })
})

const popover = () => screen.queryByRole('dialog', { name: /dictionary entry/i })

describe('grammar hints', () => {
  // These were detected and stored for every line of every song, and the only
  // renderer for them was hover-only — unusable on the phone this app is for.
  it('shows the pattern when you tap a word it covers', async () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /look up こと/i }))

    await waitFor(() => expect(popover()).toBeTruthy())
    expect(screen.getByText('〜たことがある')).toBeTruthy()
    expect(screen.getByText(/experiential perfect/i)).toBeTruthy()
  })

  it('says nothing about grammar for a word outside the pattern', async () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /look up 会っ/i }))

    await waitFor(() => expect(popover()).toBeTruthy())
    expect(screen.queryByText('〜たことがある')).toBeNull()
  })

  it('still shows the definition alongside the pattern', async () => {
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /look up こと/i }))

    await waitFor(() => expect(popover()).toBeTruthy())
    expect(screen.getByText('to meet')).toBeTruthy()
  })

  it('is quiet on a line with no detected pattern', async () => {
    useLyricsStore.setState({
      lines: [{ ...LINE, grammarAnnotations: undefined }], activeLine: 0,
    })
    render(<LyricDisplay onLineClick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /look up こと/i }))

    await waitFor(() => expect(popover()).toBeTruthy())
    expect(screen.queryByText('〜たことがある')).toBeNull()
  })
})
