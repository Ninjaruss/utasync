import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SecondLanguagePanel } from '../../src/lyrics/SecondLanguagePanel'
import type { TimedLine } from '../../src/core/types'

const primary: TimedLine[] = [
  { original: '君の瞳', startTime: 1, endTime: 3, translation: '' },
  { original: '夜の中', startTime: 3, endTime: 5, translation: '' },
]

const withTranslations: TimedLine[] = [
  { original: '君の瞳', startTime: 1, endTime: 3, translation: 'Your eyes' },
  { original: '夜の中', startTime: 3, endTime: 5, translation: 'In the night' },
]

describe('SecondLanguagePanel', () => {
  it('shows current translations on open', () => {
    render(<SecondLanguagePanel lines={withTranslations} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/current second-language lyrics/i)).toBeTruthy()
    expect(screen.getByText('Your eyes')).toBeTruthy()
    expect(screen.getByText('In the night')).toBeTruthy()
  })

  it('does not offer auto-search', () => {
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /auto-search translation/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /search lrclib/i })).toBeNull()
  })

  it('shows English translation links for Japanese songs', () => {
    render(
      <SecondLanguagePanel
        lines={primary}
        title="Renai Circulation"
        artist="Kana Hanazawa"
        sourceLanguage="ja"
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/find english translation/i)).toBeTruthy()
    expect(screen.getByText(/copy the english lines/i)).toBeTruthy()
    const animelyrics = screen.getByRole('link', { name: /animelyrics/i })
    expect(animelyrics.getAttribute('href')).toContain('animelyrics.com')
    expect(animelyrics.getAttribute('href')).toContain(encodeURIComponent('Kana Hanazawa Renai Circulation'))
    const lyricstranslate = screen.getByRole('link', { name: /lyricstranslate/i })
    expect(lyricstranslate.getAttribute('href')).toContain('lyricstranslate.com')
    expect(lyricstranslate.getAttribute('href')).toContain('english%20translation')
    expect(screen.queryByRole('link', { name: /genius/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /megchan/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /megaten/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /utaten/i })).toBeNull()
  })

  it('shows Japanese lyrics links for English songs', () => {
    render(
      <SecondLanguagePanel
        lines={[
          { original: 'My Eyes Only', startTime: 1, endTime: 3, translation: '' },
        ]}
        title="My Eyes Only"
        artist="Test Artist"
        sourceLanguage="en"
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/find japanese lyrics/i)).toBeTruthy()
    expect(screen.getByText(/copy the japanese lines/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /utaten/i }).getAttribute('href')).toContain('utaten.com')
    expect(screen.getByRole('link', { name: /uta-net/i }).getAttribute('href')).toContain('uta-net.com')
    expect(screen.getByRole('link', { name: /lrclib/i }).getAttribute('href')).toContain('lrclib.net')
    expect(screen.queryByRole('link', { name: /animelyrics/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /j-lyric/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /lyricstranslate/i })).toBeNull()
  })

  it('shows replace and paste when translations exist', () => {
    render(<SecondLanguagePanel lines={withTranslations} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /replace translation/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /paste lyrics/i })).toBeTruthy()
  })

  it('lets the user paste manually', () => {
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    expect(screen.getByPlaceholderText(/english translation/i)).toBeTruthy()
  })

  it('shows a confirm banner after pasting matched lyrics', async () => {
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    fireEvent.change(screen.getByPlaceholderText(/english translation/i), { target: { value: 'Your eyes\nIn the night' } })
    fireEvent.click(screen.getByRole('button', { name: /attach/i }))
    expect(await screen.findByText(/does this pairing look right/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /looks good/i })).toBeTruthy()
  })

  it('applies the matched translation on "Looks good"', async () => {
    const onApply = vi.fn()
    render(<SecondLanguagePanel lines={primary} title="t" artist="a" sourceLanguage="ja" onApply={onApply} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    fireEvent.change(screen.getByPlaceholderText(/english translation/i), { target: { value: 'Your eyes\nIn the night' } })
    fireEvent.click(screen.getByRole('button', { name: /attach/i }))
    fireEvent.click(await screen.findByRole('button', { name: /looks good/i }))
    const applied = onApply.mock.calls[0][0] as TimedLine[]
    expect(applied[0].translation).toBe('Your eyes')
    expect(applied[1].translation).toBe('In the night')
    expect(applied[0].startTime).toBe(1)
  })

  it('shows the alignment editor when pasted line count differs on untimed lyrics', async () => {
    const untimed: TimedLine[] = [
      { original: 'line one', startTime: 0, endTime: 0, translation: '' },
      { original: 'line two', startTime: 0, endTime: 0, translation: '' },
    ]
    render(<SecondLanguagePanel lines={untimed} title="t" artist="a" sourceLanguage="ja" onApply={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    const box = await screen.findByPlaceholderText(/english translation/i)
    fireEvent.change(box, { target: { value: 'only one line' } })
    fireEvent.click(screen.getByRole('button', { name: /attach/i }))
    expect(await screen.findByText(/align translations/i)).toBeTruthy()
  })
})
