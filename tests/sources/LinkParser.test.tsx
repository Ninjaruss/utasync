import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LinkParser } from '../../src/sources/LinkParser'
import { db } from '../../src/core/db/schema'

vi.mock('../../src/sources/youtube', () => ({
  fetchYouTubeMeta: vi.fn(async () => ({ title: 'Test Song', artist: 'Test Artist' })),
  extractVideoId: vi.fn(() => 'abc123'),
}))

vi.mock('../../src/sources/lrclib', () => ({
  findLyrics: vi.fn(async () => ({ lrc: 'Line one\nLine two', synced: false })),
  findSecondLanguageLyrics: vi.fn(async () => null),
}))

vi.mock('../../src/sources/audioIngest', () => ({
  ingestAudioFile: vi.fn(async () => ({ songId: 'id1', audioStoredPath: 'songs/id1.mp3' })),
}))

beforeEach(async () => {
  await db.songs.clear()
  const lrclib = await import('../../src/sources/lrclib')
  vi.mocked(lrclib.findLyrics).mockReset()
  vi.mocked(lrclib.findLyrics).mockResolvedValue({ lrc: 'Line one\nLine two', synced: false })
  vi.mocked(lrclib.findSecondLanguageLyrics).mockReset()
  vi.mocked(lrclib.findSecondLanguageLyrics).mockResolvedValue(null)
})

async function continueToLyricsFound(onSongReady: (id: string) => void) {
  render(<LinkParser onSongReady={onSongReady} />)
  fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  await waitFor(() => expect(screen.getByLabelText(/song title/i)).toHaveValue('Test Song'))
  await waitFor(() => expect(screen.getByText(/found plain lyrics/i)).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /add song/i }))
  await waitFor(() => expect(onSongReady).toHaveBeenCalled())
}

describe('LinkParser', () => {
  it('shows editable title and artist before adding a song', async () => {
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByLabelText(/song title/i)).toHaveValue('Test Song'))
    expect(screen.getByLabelText(/^artist$/i)).toHaveValue('Test Artist')
    expect(onSongReady).not.toHaveBeenCalled()
  })

  it('auto-searches LRCLIB after metadata loads and adds the song', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    const onSongReady = vi.fn()
    await continueToLyricsFound(onSongReady)
    expect(lrclib.findLyrics).toHaveBeenCalledWith('Test Song', 'Test Artist')
    expect(screen.queryByText(/paste a second/i)).not.toBeInTheDocument()
  })

  it('auto-attaches a translation on add song when counts match', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findSecondLanguageLyrics).mockResolvedValueOnce({ lrc: 'Translated one\nTranslated two', synced: false })
    const onSongReady = vi.fn()
    await continueToLyricsFound(onSongReady)
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.lyrics.lines.map((l) => l.translation)).toEqual(['Translated one', 'Translated two'])
  })

  it('lets the user skip LRCLIB search and paste lyrics', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findLyrics).mockImplementation(() => new Promise(() => {}))
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByText(/searching lrclib/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/paste lyrics/i)).toBeInTheDocument())
    expect(lrclib.findLyrics).toHaveBeenCalled()
  })

  it('attaches uploaded audio to the built song when provided', async () => {
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' })
    const fileInput = screen.getAllByLabelText(/attach audio/i).find((el) => el.tagName === 'INPUT') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByText(/found plain lyrics/i)).toBeInTheDocument(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /add song/i }))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.audioStoredPath).toBeTruthy()
    expect(song?.audioStoredPath).toBe(`songs/${song?.id}.mp3`)
  })
})
