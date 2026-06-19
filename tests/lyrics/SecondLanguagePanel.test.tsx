import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SecondLanguagePanel } from '../../src/lyrics/SecondLanguagePanel'
import type { TimedLine } from '../../src/core/types'

const findMock = vi.fn()
vi.mock('../../src/sources/lrclib', () => ({
  findSecondLanguageLyrics: (...a: unknown[]) => findMock(...a),
}))

const primary: TimedLine[] = [
  { original: '君の瞳', startTime: 1, endTime: 3, translation: '' },
  { original: '夜の中', startTime: 3, endTime: 5, translation: '' },
]

let pendingSearchResolve: ((value: { lrc: string; synced: boolean } | null) => void) | undefined

beforeEach(() => {
  findMock.mockReset()
  pendingSearchResolve = undefined
})

afterEach(() => {
  pendingSearchResolve?.(null)
  pendingSearchResolve = undefined
})

describe('SecondLanguagePanel', () => {
  it('auto-finds and shows a confirm banner when counts match', async () => {
    findMock.mockResolvedValue({ lrc: 'Your eyes\nIn the night', synced: false })
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText(/does this pairing look right/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /looks good/i })).toBeTruthy()
  })

  it('previews the matched translation lines in the confirm banner', async () => {
    findMock.mockResolvedValue({ lrc: 'Your eyes\nIn the night', synced: false })
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText(/does this pairing look right/i)
    expect(screen.getByText('Your eyes')).toBeTruthy()
    expect(screen.getByText('In the night')).toBeTruthy()
  })

  it('applies the matched translation on "Looks good"', async () => {
    findMock.mockResolvedValue({ lrc: 'Your eyes\nIn the night', synced: false })
    const onApply = vi.fn()
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={onApply} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /looks good/i }))
    const applied = onApply.mock.calls[0][0] as TimedLine[]
    expect(applied[0].translation).toBe('Your eyes')
    expect(applied[1].translation).toBe('In the night')
    expect(applied[0].startTime).toBe(1)
  })

  it('falls back to a paste box when nothing is found', async () => {
    findMock.mockResolvedValue(null)
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByPlaceholderText(/paste/i)).toBeTruthy()
  })

  it('lets the user skip LRCLIB search and paste manually', () => {
    findMock.mockImplementation(() => new Promise((resolve) => { pendingSearchResolve = resolve }))
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /skip and paste lyrics/i }))
    expect(screen.getByPlaceholderText(/paste/i)).toBeTruthy()
    expect(screen.queryByText(/does this pairing look right/i)).toBeNull()
  })

  it('ignores a late LRCLIB result after the user skipped search', async () => {
    findMock.mockImplementation(() => new Promise((resolve) => { pendingSearchResolve = resolve }))
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /skip and paste lyrics/i }))
    expect(screen.getByPlaceholderText(/paste/i)).toBeTruthy()
    pendingSearchResolve?.({ lrc: 'Your eyes\nIn the night', synced: false })
    pendingSearchResolve = undefined
    await Promise.resolve()
    expect(screen.queryByText(/does this pairing look right/i)).toBeNull()
    expect(screen.getByPlaceholderText(/paste/i)).toBeTruthy()
  })

  it('shows the alignment editor when pasted line count differs on untimed lyrics', async () => {
    findMock.mockResolvedValue(null)
    const untimed: TimedLine[] = [
      { original: 'line one', startTime: 0, endTime: 0, translation: '' },
      { original: 'line two', startTime: 0, endTime: 0, translation: '' },
    ]
    render(<SecondLanguagePanel lines={untimed} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    const box = await screen.findByPlaceholderText(/paste/i)
    fireEvent.change(box, { target: { value: 'only one line' } })
    fireEvent.click(screen.getByRole('button', { name: /attach/i }))
    expect(await screen.findByText(/align translations/i)).toBeTruthy()
  })
})
