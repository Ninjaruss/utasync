import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LinkParser } from '../../src/sources/LinkParser'
import { db } from '../../src/core/db/schema'
import { mp3File } from './helpers/audioFixtures'

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
  await waitFor(() => expect(screen.getByText(/found text-only lyrics/i)).toBeInTheDocument(), { timeout: 3000 })
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
    await waitFor(() => expect(screen.getByText(/fetching youtube captions/i)).toBeInTheDocument(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/paste lyrics/i)).toBeInTheDocument())
    expect(resolver.resolveLyricsForSong).toHaveBeenCalled()
  })

  it('offers Search again after a failed search and re-runs the lookup', async () => {
    const resolver = await import('../../src/sources/lyricsResolver')
    vi.mocked(resolver.resolveLyricsForSong).mockResolvedValue({ lines: [], synced: false, source: 'none' })
    render(<LinkParser onSongReady={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByText(/no match in captions or the lyrics database/i)).toBeInTheDocument(), { timeout: 3000 })
    expect(resolver.resolveLyricsForSong).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /search again/i }))
    await waitFor(() => expect(resolver.resolveLyricsForSong).toHaveBeenCalledTimes(2), { timeout: 3000 })
  })

  // The sheet's close guard asks "Discard this song?" only when the flow reports
  // itself dirty. In the link flow nothing ever marked the metadata fields dirty,
  // so correct the parsed title/artist and closing dropped the correction with no
  // prompt.
  describe('dirty tracking', () => {
    async function loadMetadata(onDirtyChange: (d: boolean) => void) {
      render(<LinkParser onSongReady={vi.fn()} onDirtyChange={onDirtyChange} />)
      fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
      await waitFor(() => expect(screen.getByLabelText(/song title/i)).toHaveValue('Test Song'))
    }

    it('marks the sheet dirty on a title correction', async () => {
      const onDirtyChange = vi.fn()
      await loadMetadata(onDirtyChange)
      onDirtyChange.mockClear()
      fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: 'Corrected Title' } })
      await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true))
    })

    it('marks the sheet dirty on an artist correction alone', async () => {
      const onDirtyChange = vi.fn()
      await loadMetadata(onDirtyChange)
      onDirtyChange.mockClear()
      fireEvent.change(screen.getByLabelText(/^artist$/i), { target: { value: 'Corrected Artist' } })
      await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true))
    })

    it('marks the sheet dirty when a subtitle file is attached', async () => {
      const resolver = await import('../../src/sources/lyricsResolver')
      vi.mocked(resolver.resolveLyricsForSong).mockResolvedValue({ lines: [], synced: false, source: 'none' })
      const onDirtyChange = vi.fn()
      const { container } = render(<LinkParser onSongReady={vi.fn()} onDirtyChange={onDirtyChange} />)
      fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
      await waitFor(() => expect(screen.getByText(/no match in captions or the lyrics database/i)).toBeInTheDocument(), { timeout: 3000 })

      fireEvent.click(screen.getByRole('button', { name: /subtitle file/i }))
      onDirtyChange.mockClear()
      const subtitleInput = container.querySelector('input[accept*=".srt"]') as HTMLInputElement
      fireEvent.change(subtitleInput, { target: { files: [new File(['x'], 'cap.srt', { type: 'text/plain' })] } })
      await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true))
    })
  })

  it('attaches uploaded audio to the built song when provided', async () => {
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    const file = mp3File()
    const fileInput = screen.getAllByLabelText(/add audio file/i).find((el) => el.tagName === 'INPUT') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.getByText(/found text-only lyrics/i)).toBeInTheDocument(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /add song/i }))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.audioStoredPath).toBeTruthy()
    expect(song?.audioStoredPath).toBe(`songs/${song?.id}.mp3`)
  })
})
