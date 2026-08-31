import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UploadAudioFlow } from '../../src/sources/UploadAudioFlow'
import { db } from '../../src/core/db/schema'

vi.mock('../../src/sources/audioIngest', () => ({
  ingestAudioFile: vi.fn(async () => ({ songId: 'id1', audioStoredPath: 'songs/id1.mp3' })),
}))
vi.mock('../../src/sources/lrclib', () => ({
  findLyrics: vi.fn(async () => ({ lookup: null, outcome: 'no-entry' })),
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
  vi.mocked(lrclib.findLyrics).mockResolvedValue({ lookup: null, outcome: 'no-entry' })
})

async function pickFileAndTitle(container: HTMLElement, title = 'Mistyped Titel') {
  fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: title } })
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })
  await waitFor(() => expect(screen.getByRole('button', { name: /paste lyrics/i })).toBeInTheDocument())
}

describe('correcting the title after a failed search', () => {
  it('searches again once the title is fixed', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    await pickFileAndTitle(container)
    await waitFor(() => expect(vi.mocked(lrclib.findLyrics)).toHaveBeenCalled())
    const afterFirst = vi.mocked(lrclib.findLyrics).mock.calls.length

    // The user notices the typo and fixes it.
    fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: 'Correct Title' } })

    await waitFor(
      () => expect(vi.mocked(lrclib.findLyrics).mock.calls.length).toBeGreaterThan(afterFirst),
      { timeout: 3000 },
    )
  })

  it('does NOT discard lyrics the user already pasted', async () => {
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    await pickFileAndTitle(container)
    const box = await screen.findByPlaceholderText(/paste lyrics/i)
    fireEvent.change(box, { target: { value: 'my hand typed line\nsecond line' } })

    fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: 'Correct Title' } })

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/paste lyrics/i)).toHaveValue('my hand typed line\nsecond line')
    })
  })
})

describe('the failure message says what actually happened', () => {
  it('does not blame the catalogue when the device is offline', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findLyrics).mockResolvedValue({ lookup: null, outcome: 'offline' })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    await pickFileAndTitle(container)
    expect(await screen.findByText(/offline/i)).toBeInTheDocument()
    expect(screen.queryByText(/no match in the lyrics database/i)).not.toBeInTheDocument()
  })

  it('says the service is busy when rate-limited', async () => {
    const lrclib = await import('../../src/sources/lrclib')
    vi.mocked(lrclib.findLyrics).mockResolvedValue({ lookup: null, outcome: 'rate-limited' })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)
    await pickFileAndTitle(container)
    expect(await screen.findByText(/busy right now/i)).toBeInTheDocument()
  })
})
