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
})

describe('LinkParser', () => {
  it('creates a song immediately with no second-language prompt when none is found', async () => {
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByText('Get Lyrics'))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    expect(screen.queryByText(/paste a second/i)).not.toBeInTheDocument()
  })

  it('auto-attaches a translation silently when found and counts match', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findSecondLanguageLyrics).mockResolvedValueOnce({ lrc: 'Translated one\nTranslated two' })
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByText('Get Lyrics'))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.lyrics.lines.map((l) => l.translation)).toEqual(['Translated one', 'Translated two'])
  })

  it('skips a mismatched translation silently, opening with primary lines only', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findSecondLanguageLyrics).mockResolvedValueOnce({ lrc: 'Only one translated line' })
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    fireEvent.click(screen.getByText('Get Lyrics'))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.lyrics.lines.map((l) => l.translation)).toEqual(['', ''])
  })

  it('attaches uploaded audio to the built song when provided', async () => {
    const onSongReady = vi.fn()
    render(<LinkParser onSongReady={onSongReady} />)
    fireEvent.change(screen.getByPlaceholderText(/paste a youtube link/i), { target: { value: 'https://youtu.be/abc123' } })
    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' })
    const fileInput = screen.getAllByLabelText(/attach audio/i).find((el) => el.tagName === 'INPUT') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByText('Get Lyrics'))
    await waitFor(() => expect(onSongReady).toHaveBeenCalled())
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    expect(song?.audioStoredPath).toBeTruthy()
  })
})
