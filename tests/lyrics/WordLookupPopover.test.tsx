import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { WordLookupPopover } from '../../src/lyrics/WordLookupPopover'
import type { Token } from '../../src/core/types'
import { useSettingsStore } from '../../src/payment/SettingsStore'

const lookupWord = vi.fn()
vi.mock('../../src/language/japanese/wordLookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/language/japanese/wordLookup')>()
  return { ...actual, lookupWord: (token: Token, mode?: unknown, opts?: unknown) => lookupWord(token, mode, opts) }
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

  it('shows the English POS label, not the raw kuromoji tag', async () => {
    lookupWord.mockResolvedValue({ headword: 'は', reading: 'は', pos: '助詞', posLabel: 'particle', glosses: ['topic marker'], dictionaryAvailable: true })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('topic marker')).toBeTruthy())
    expect(screen.getByText('particle')).toBeTruthy()
    expect(screen.queryByText('助詞')).toBeNull()
  })

  it('shows a promoted sung reading first with the dictionary reading as secondary', async () => {
    lookupWord.mockResolvedValue({ headword: '術', reading: 'すべ', dictionaryReading: 'じゅつ', pos: '名詞', posLabel: 'noun', glosses: ['way'], dictionaryAvailable: true })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('すべ')).toBeTruthy())
    expect(screen.getByText(/dictionary: じゅつ/)).toBeTruthy()
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
    // Consume the one-shot click swallower installed by the dismissal so it
    // can't leak into later tests in this file.
    fireEvent.click(document.body)
  })

  it('swallows the click that follows a dismissing outside pointerdown, one-shot', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true })
    const onClose = vi.fn()
    const onSiblingClick = vi.fn()
    render(
      <div>
        <button type="button" onClick={onSiblingClick}>seek row underneath</button>
        <WordLookupPopover token={token} anchorRect={null} onClose={onClose} />
      </div>,
    )
    await waitFor(() => expect(screen.getByText('to dodge')).toBeTruthy())
    const sibling = screen.getByRole('button', { name: 'seek row underneath' })

    fireEvent.pointerDown(sibling)
    expect(onClose).toHaveBeenCalledTimes(1)
    // The click completing the dismissing tap must not reach what's underneath.
    fireEvent.click(sibling)
    expect(onSiblingClick).not.toHaveBeenCalled()
    // One-shot: the next independent click goes through normally.
    fireEvent.click(sibling)
    expect(onSiblingClick).toHaveBeenCalledTimes(1)
  })

  it('the click swallower survives the popover unmounting on dismiss', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true })
    const onSiblingClick = vi.fn()
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <div>
          <button type="button" onClick={onSiblingClick}>seek row underneath</button>
          {open && <WordLookupPopover token={token} anchorRect={null} onClose={() => setOpen(false)} />}
        </div>
      )
    }
    render(<Harness />)
    await waitFor(() => expect(screen.getByText('to dodge')).toBeTruthy())
    const sibling = screen.getByRole('button', { name: 'seek row underneath' })

    fireEvent.pointerDown(sibling)
    await waitFor(() => expect(screen.queryByText('to dodge')).toBeNull())
    fireEvent.click(sibling)
    expect(onSiblingClick).not.toHaveBeenCalled()
    // Consume/verify one-shot removal.
    fireEvent.click(sibling)
    expect(onSiblingClick).toHaveBeenCalledTimes(1)
  })

  it('has a Close button that dismisses the card', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true })
    const onClose = vi.fn()
    render(<WordLookupPopover token={token} anchorRect={null} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('to dodge')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sits just above the player dock in the bottom-card layout', async () => {
    lookupWord.mockResolvedValue({ headword: '躱す', reading: 'かわす', pos: '動詞', glosses: ['to dodge'], dictionaryAvailable: true })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(dialog.style.bottom).toBe('calc(var(--player-dock-height, 96px) + 12px)')
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

  it('passes the immersion flag and links to weblio 国語辞書 when immersion is on', async () => {
    useSettingsStore.setState({ immersionDefinitions: true })
    lookupWord.mockResolvedValue({ headword: '走る', reading: 'はしる', pos: '動詞', posLabel: 'verb', glosses: ['速く移動する'], dictionaryAvailable: true, definitionLang: 'ja' })
    render(<WordLookupPopover token={token} anchorRect={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('速く移動する')).toBeTruthy())
    expect(screen.getByRole('link').getAttribute('href')).toBe(`https://www.weblio.jp/content/${encodeURIComponent('走る')}`)
    const def = screen.getByText('速く移動する')
    expect(def.getAttribute('lang')).toBe('ja')
    expect(def.className).toContain('font-jp')
    useSettingsStore.setState({ immersionDefinitions: false })
  })
})
