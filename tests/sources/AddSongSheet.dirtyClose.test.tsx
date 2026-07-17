import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddSongSheet } from '../../src/sources/AddSongSheet'

vi.mock('../../src/sources/lrclib', () => ({
  findLyrics: vi.fn(async () => null),
}))

import { extractAudioMetadata } from '../../src/sources/audioMetadata'
vi.mock('../../src/sources/audioMetadata', async (orig) => {
  const actual = await orig<typeof import('../../src/sources/audioMetadata')>()
  return { ...actual, extractAudioMetadata: vi.fn().mockResolvedValue({}) }
})

beforeEach(async () => {
  vi.mocked(extractAudioMetadata).mockResolvedValue({})
  const lrclib = await import('../../src/sources/lrclib')
  vi.mocked(lrclib.findLyrics).mockReset()
  vi.mocked(lrclib.findLyrics).mockResolvedValue(null)
})

const backdrop = () => screen.getByRole('button', { name: /dismiss/i })

describe('AddSongSheet dirty-close guard', () => {
  it('closes immediately on backdrop tap when nothing has been entered', () => {
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    fireEvent.click(backdrop())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks before discarding a user-typed title on backdrop tap', () => {
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: 'My Song' } })

    fireEvent.click(backdrop())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Discard this song?')).toBeInTheDocument()
    expect(screen.getByText('Your pasted lyrics will be lost.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /keep working/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks before discarding pasted lyrics and closes on Discard', async () => {
    const onClose = vi.fn()
    const { container } = render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: 'My Song' } })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })
    await waitFor(
      () => expect(screen.getByText(/no match in the lyrics database/i)).toBeInTheDocument(),
      { timeout: 3000 },
    )
    fireEvent.change(screen.getByPlaceholderText(/paste lyrics/i), { target: { value: 'Line one\nLine two' } })

    fireEvent.click(backdrop())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Your pasted lyrics will be lost.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the in-progress copy when a lyric search is running', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findLyrics).mockImplementation(() => new Promise(() => {}))
    const onClose = vi.fn()
    const { container } = render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: 'My Song' } })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })
    await waitFor(
      () => expect(screen.getByText(/checking the lyrics database for an exact match/i)).toBeInTheDocument(),
      { timeout: 3000 },
    )

    fireEvent.click(backdrop())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/lyric search or saving is still in progress/i)).toBeInTheDocument()
  })
})
