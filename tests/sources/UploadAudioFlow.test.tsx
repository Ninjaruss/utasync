import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UploadAudioFlow } from '../../src/sources/UploadAudioFlow'
import { db } from '../../src/core/db/schema'

const ingestAudioFile = vi.fn(async () => ({ songId: 'id1', audioStoredPath: 'songs/id1.mp3' }))
vi.mock('../../src/sources/audioIngest', () => ({
  ingestAudioFile: (file: File) => ingestAudioFile(file),
}))

vi.mock('../../src/sources/lrclib', () => ({
  findLyrics: vi.fn(async () => null),
}))


import { extractAudioMetadata } from '../../src/sources/audioMetadata'
vi.mock('../../src/sources/audioMetadata', async (orig) => {
  const actual = await orig<typeof import('../../src/sources/audioMetadata')>()
  return { ...actual, extractAudioMetadata: vi.fn().mockResolvedValue({}) }
})

beforeEach(async () => {
  await db.songs.clear()
  vi.mocked(extractAudioMetadata).mockResolvedValue({})
  const lrclib = await import('../../src/sources/lrclib')
  vi.mocked(lrclib.findLyrics).mockReset()
  vi.mocked(lrclib.findLyrics).mockResolvedValue(null)
})

async function pickFileAndTitle(container: HTMLElement, title = 'My Song') {
  fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: title } })
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })
  await waitFor(() => expect(screen.getByRole('button', { name: /paste lyrics/i })).toBeInTheDocument())
}

describe('UploadAudioFlow', () => {
  it('renders labeled song title and artist fields with lyric fallback options', async () => {
    render(<UploadAudioFlow onSongReady={() => {}} />)
    expect(screen.getByLabelText(/song title/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^artist$/i)).toBeInTheDocument()
  })

  it('disables submit until a file, title, and lyrics are provided', async () => {
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    await pickFileAndTitle(container)
    expect(screen.getByRole('button', { name: /add song/i })).toBeDisabled()
  })

  it('keeps add disabled for whitespace-only pasted lyrics', async () => {
    const onSongReady = vi.fn()
    const { container } = render(<UploadAudioFlow onSongReady={onSongReady} />)
    await pickFileAndTitle(container)
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/paste lyrics/i)).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/paste lyrics/i), { target: { value: '   \n  ' } })

    expect(screen.getByRole('button', { name: /add song/i })).toBeDisabled()
    expect(ingestAudioFile).not.toHaveBeenCalled()
    expect(onSongReady).not.toHaveBeenCalled()
  })

  it('auto-fills empty title and artist from file tags with source labels', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({ title: 'Tagged Title', artist: 'Tagged Artist' })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'whatever.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(screen.getByLabelText(/song title/i)).toHaveValue('Tagged Title'))
    expect(screen.getByLabelText(/^artist$/i)).toHaveValue('Tagged Artist')
    expect(screen.getAllByText(/from file tags/i).length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to the filename (without extension) when there is no title tag', async () => {
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'My Eyes Only.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(screen.getByLabelText(/song title/i)).toHaveValue('My Eyes Only'))
    expect(screen.getByText(/from filename/i)).toBeInTheDocument()
  })

  it('does not overwrite a title the user already typed', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({ title: 'Tagged Title' })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: 'My Manual Title' } })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(extractAudioMetadata).toHaveBeenCalled())
    expect(screen.getByLabelText(/song title/i)).toHaveValue('My Manual Title')
  })

  it('falls back to artist/title parsed from "Artist - Title" filename when there are no tags', async () => {
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'Yorushika - Itte.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(screen.getByLabelText(/song title/i)).toHaveValue('Itte'))
    expect((screen.getByLabelText(/^artist$/i) as HTMLInputElement).value).toBe('Yorushika')
  })

  it('swaps title and artist when the swap control is used', async () => {
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'Yorushika - Itte.mp3', { type: 'audio/mpeg' })] } })
    await waitFor(() => expect(screen.getByLabelText(/song title/i)).toHaveValue('Itte'))

    fireEvent.click(screen.getByRole('button', { name: /swap title and artist/i }))
    expect(screen.getByLabelText(/song title/i)).toHaveValue('Yorushika')
    expect(screen.getByLabelText(/^artist$/i)).toHaveValue('Itte')
  })

  it('auto-searches LRCLIB when file and title are set', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findLyrics).mockResolvedValue({
      lrc: '[00:01.00]Line one\n[00:02.00]Line two',
      synced: true,
    })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    await pickFileAndTitle(container)

    await waitFor(() => expect(screen.getByText(/found synced lyrics/i)).toBeInTheDocument())
    expect(lrclib.findLyrics).toHaveBeenCalledWith('My Song', '', expect.any(Function), undefined, 'ja')
  })

  it('forwards the decoded track duration to LRCLIB lookup', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({ durationSec: 184.32 })
    const lrclib = await import('../../src/sources/lrclib')
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    await pickFileAndTitle(container)

    await waitFor(() => expect(lrclib.findLyrics).toHaveBeenCalledWith('My Song', '', expect.any(Function), 184.32, 'ja'))
  })

  it('lets the user skip LRCLIB search and paste lyrics instead', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findLyrics).mockImplementation(() => new Promise(() => {}))
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    await pickFileAndTitle(container)
    await waitFor(() => expect(screen.getByText(/checking lrclib for an exact match/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    await waitFor(() => expect(screen.getByPlaceholderText(/paste lyrics/i)).toBeInTheDocument())
    expect(lrclib.findLyrics).toHaveBeenCalled()
  })

  it('does not render a manual second-language paste textarea', () => {
    render(<UploadAudioFlow onSongReady={() => {}} />)
    expect(screen.queryByPlaceholderText(/second-language lyrics/i)).not.toBeInTheDocument()
  })

  async function submitWithPastedLyrics(onSongReady: (songId: string) => void) {
    const { container } = render(<UploadAudioFlow onSongReady={onSongReady} />)
    await pickFileAndTitle(container)
    await waitFor(() => expect(screen.queryByText(/checking lrclib/i)).not.toBeInTheDocument(), { timeout: 3000 })
    if (!screen.queryByPlaceholderText(/paste lyrics/i)) {
      fireEvent.click(screen.getByRole('button', { name: /paste lyrics/i }))
    }
    const textarea = await screen.findByPlaceholderText(/paste lyrics/i)
    fireEvent.change(textarea, { target: { value: 'Line one\nLine two' } })
    fireEvent.click(screen.getByRole('button', { name: /add song/i }))
  }

  it('does not auto-attach a second language on add song', async () => {
    const onSongReady = vi.fn()
    await submitWithPastedLyrics(onSongReady)

    await waitFor(() => expect(onSongReady).toHaveBeenCalled(), { timeout: 5000 })
    const songId = onSongReady.mock.calls[0][0]
    const song = await db.songs.get(songId)
    // Translations stay empty — the second-language search was removed from import.
    expect(song?.lyrics.lines.every((l) => !l.translation)).toBe(true)
  })
})
