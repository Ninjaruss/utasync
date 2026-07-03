import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LinkParser } from '../../src/sources/LinkParser'
import { db } from '../../src/core/db/schema'

vi.mock('../../src/sources/youtube', () => ({
  fetchYouTubeMeta: vi.fn(async () => ({ title: 'Test Song', artist: 'Test Artist', videoId: 'abc123' })),
  extractVideoId: vi.fn(() => 'abc123'),
}))

vi.mock('../../src/sources/lyricsResolver', () => ({
  resolveLyricsForSong: vi.fn(async () => ({
    lines: [
      { startTime: 0, endTime: 0, original: 'Line one', translation: '' },
      { startTime: 0, endTime: 0, original: 'Line two', translation: '' },
    ],
    synced: false,
    source: 'lrclib-plain',
  })),
  lyricsSourceLabel: vi.fn(() => 'LRCLIB (plain)'),
}))


vi.mock('../../src/sources/audioIngest', () => ({
  ingestAudioFile: vi.fn(async () => ({ songId: 'id1', audioStoredPath: 'songs/id1.mp3' })),
}))

beforeEach(async () => {
  await db.songs.clear()
  const resolver = await import('../../src/sources/lyricsResolver')
  vi.mocked(resolver.resolveLyricsForSong).mockReset()
  vi.mocked(resolver.resolveLyricsForSong).mockResolvedValue({
    lines: [
      { startTime: 0, endTime: 0, original: 'Line one', translation: '' },
      { startTime: 0, endTime: 0, original: 'Line two', translation: '' },
    ],
    synced: false,
    source: 'lrclib-plain',
  })
  vi.mocked(resolver.lyricsSourceLabel).mockReturnValue('LRCLIB (plain)')
})

async function continueToLyricsFound(onSongReady: (id: string) => void) {
  render(<LinkParser onSongReady={onSongReady} />)
  fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  await waitFor(() => expect(screen.getByLabelText(/song title/i)).toHaveValue('Test Song'))
  await waitFor(() => expect(screen.getByText(/found plain lyrics/i)).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /add song/i }))
  await waitFor(() => expect(onSongReady).toHaveBeenCalled(), { timeout: 5000 })
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

  it('auto-resolves lyrics after metadata loads and adds the song', async () => {
    const resolver = await import('../../src/sources/lyricsResolver')
    const onSongReady = vi.fn()
    await continueToLyricsFound(onSongReady)
    expect(resolver.resolveLyricsForSong).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test Song',
        artist: 'Test Artist',
        videoId: 'abc123',
      }),
    )
  })

  it('does not auto-attach a second language on add song', async () => {
    const onSongReady = vi.fn()
    await continueToLyricsFound(onSongReady)
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    // Translations stay empty — the second-language search was removed from import.
    expect(song?.lyrics.lines.every((l) => !l.translation)).toBe(true)
  })

  it('lets the user skip search and paste lyrics', async () => {
    const resolver = await import('../../src/sources/lyricsResolver')
    vi.mocked(resolver.resolveLyricsForSong).mockImplementation(() => new Promise(() => {}))
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByText(/fetching youtube captions/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/paste lyrics/i)).toBeInTheDocument())
    expect(resolver.resolveLyricsForSong).toHaveBeenCalled()
  })

  it('attaches uploaded audio to the built song when provided', async () => {
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' })
    const fileInput = screen.getAllByLabelText(/add audio file/i).find((el) => el.tagName === 'INPUT') as HTMLInputElement
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
