import { describe, it, expect, vi, beforeEach } from 'vitest'
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

beforeEach(() => findMock.mockReset())

describe('SecondLanguagePanel', () => {
  it('auto-finds and shows a confirm banner when counts match', async () => {
    findMock.mockResolvedValue({ lrc: 'Your eyes\nIn the night', synced: false })
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText(/found translation/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /looks good/i })).toBeTruthy()
  })

  it('previews the matched translation lines in the confirm banner', async () => {
    findMock.mockResolvedValue({ lrc: 'Your eyes\nIn the night', synced: false })
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    await screen.findByText(/found translation/i)
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

  it('shows the alignment editor when pasted line count differs', async () => {
    findMock.mockResolvedValue(null)
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    const box = await screen.findByPlaceholderText(/paste/i)
    fireEvent.change(box, { target: { value: 'only one line' } })
    fireEvent.click(screen.getByRole('button', { name: /attach/i }))
    expect(await screen.findByText(/align lines/i)).toBeTruthy()
  })
})
