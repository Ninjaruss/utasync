import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { WordLookupPopover } from '../../src/lyrics/WordLookupPopover'
import type { Token } from '../../src/core/types'

const lookupWord = vi.fn()
vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return { ...actual, lookupWord: (token: Token) => lookupWord(token) }
})

const token: Token = { surface: '躱し', reading: 'カワシ', pos: '動詞', baseForm: '躱す', startIndex: 0, endIndex: 2 }

describe('WordLookupPopover', () => {
  beforeEach(() => {
    lookupWord.mockReset()
  })

  it('shows headword, reading, and glosses once resolved', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge', 'to evade'], dictionaryAvailable: true })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('to dodge; to evade')).toBeTruthy())
    expect(screen.getByText('躱す')).toBeTruthy()
    expect(screen.getByText('かわす')).toBeTruthy()
  })

  it('links to jisho.org for the headword', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: [], dictionaryAvailable: true })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('link')).toBeTruthy())
    expect(screen.getByRole('link').getAttribute('href')).toBe(`https://jisho.org/search/${encodeURIComponent('躱す')}`)
  })

  it('shows a fallback message when no gloss exists', async () => {
    lookupWord.mockResolvedValue({ headword: '骨頂', reading: 'こっちょう', pos: '名詞', glosses: [], dictionaryAvailable: true })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('No definition found.')).toBeTruthy())
  })

  it('says definitions are unavailable when the dictionary failed to load', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: [], dictionaryAvailable: false })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Definitions unavailable.')).toBeTruthy())
  })

  it('closes on pointerdown outside, not inside', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true })
    const onClose = vi.fn()
    render(<WordLookupPopover token={token} anchorRect={null} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('to dodge')).toBeTruthy())
    fireEvent.pointerDown(screen.getByText('to dodge'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing for a null lookup result', async () => {
    lookupWord.mockResolvedValue(null)
    const { container } = render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('anchors below the tapped word when it fits', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true })
    const anchorRect = { left: 100, top: 100, bottom: 120, right: 120 } as DOMRect
    render(<WordLookupPopover token={token} anchorRect={anchorRect} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(dialog.style.top).toBe('128px')
    expect(dialog.style.left).toBe('100px')
  })

  it('clamps the anchored position inside the right viewport edge', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true })
    const anchorRect = { left: 1000, top: 100, bottom: 120, right: 1020 } as DOMRect
    render(<WordLookupPopover token={token} anchorRect={anchorRect} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(dialog.style.left).toBe('728px') // 1024 - 288 - 8
  })

  it('flips above the word when the card would not fit below', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true })
    const anchorRect = { left: 100, top: 700, bottom: 720, right: 120 } as DOMRect
    render(<WordLookupPopover token={token} anchorRect={anchorRect} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(dialog.style.bottom).toBe('76px') // 768 - 700 + 8
    expect(dialog.style.top).toBe('')
  })
})
