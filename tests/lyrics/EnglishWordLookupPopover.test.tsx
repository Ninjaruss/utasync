import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { EnglishWordLookupPopover } from '../../src/lyrics/EnglishWordLookupPopover'
import { useSettingsStore } from '../../src/payment/SettingsStore'

const lookupEnglishWord = vi.fn()
vi.mock('../../src/language/english/wordLookupEn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/english/wordLookupEn')>()
  return { ...actual, lookupEnglishWord: (w: string, o?: unknown) => lookupEnglishWord(w, o) }
})

describe('EnglishWordLookupPopover', () => {
  beforeEach(() => lookupEnglishWord.mockReset())

  it('shows the English headword and Japanese equivalents', async () => {
    lookupEnglishWord.mockResolvedValue({ headword: 'spring', definitionLang: 'ja', equivalents: [{ ja: '春', reading: 'はる' }, { ja: '泉', reading: 'いずみ' }], definitions: [], dictionaryAvailable: true })
    render(<EnglishWordLookupPopover word="Spring" anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('春')).toBeTruthy())
    expect(screen.getByText('はる')).toBeTruthy()
    expect(screen.getByText('泉')).toBeTruthy()
    expect(screen.getByText('spring')).toBeTruthy()
  })

  it('links to jisho.org for the English word', async () => {
    lookupEnglishWord.mockResolvedValue({ headword: 'spring', definitionLang: 'ja', equivalents: [], definitions: [], dictionaryAvailable: true })
    render(<EnglishWordLookupPopover word="spring" anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('link')).toBeTruthy())
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://jisho.org/search/spring')
  })

  it('shows a not-found message when there are no equivalents', async () => {
    lookupEnglishWord.mockResolvedValue({ headword: 'xyzzy', definitionLang: 'ja', equivalents: [], definitions: [], dictionaryAvailable: true })
    render(<EnglishWordLookupPopover word="xyzzy" anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('No definition found.')).toBeTruthy())
  })

  it('renders nothing (and closes) for a null result', async () => {
    lookupEnglishWord.mockResolvedValue(null)
    const onClose = vi.fn()
    const { container } = render(<EnglishWordLookupPopover word="…" anchorRect={null} onClose={onClose} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
    expect(onClose).toHaveBeenCalled()
  })

  it('passes immersion and shows English definitions when immersion is on', async () => {
    useSettingsStore.setState({ immersionDefinitions: true })
    lookupEnglishWord.mockResolvedValue({ headword: 'spring', definitionLang: 'en', equivalents: [], definitions: ['the season of growth'], dictionaryAvailable: true })
    render(<EnglishWordLookupPopover word="spring" anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('the season of growth')).toBeTruthy())
    expect(lookupEnglishWord).toHaveBeenCalledWith('spring', { immersion: true })
    useSettingsStore.setState({ immersionDefinitions: false })
  })
})
