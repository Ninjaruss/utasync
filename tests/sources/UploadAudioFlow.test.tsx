// tests/sources/UploadAudioFlow.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UploadAudioFlow } from '../../src/sources/UploadAudioFlow'

const ingestAudioFile = vi.fn(async () => ({ songId: 'id1', audioStoredPath: 'songs/id1.mp3' }))
vi.mock('../../src/sources/audioIngest', () => ({
  ingestAudioFile: (file: File) => ingestAudioFile(file),
}))

import { extractAudioMetadata } from '../../src/sources/audioMetadata'
vi.mock('../../src/sources/audioMetadata', async (orig) => {
  const actual = await orig<typeof import('../../src/sources/audioMetadata')>()
  // Default: no tags found (helper contract is to always resolve to an object).
  return { ...actual, extractAudioMetadata: vi.fn().mockResolvedValue({}) }
})

describe('UploadAudioFlow', () => {
  it('renders file, title, artist inputs and the three lyric source options', () => {
    render(<UploadAudioFlow onSongReady={() => {}} />)
    expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/artist/i)).toBeInTheDocument()
    expect(screen.getByText(/find lyrics/i)).toBeInTheDocument()
    expect(screen.getByText(/paste lyrics/i)).toBeInTheDocument()
    expect(screen.getByText(/subtitle file/i)).toBeInTheDocument()
  })

  it('disables submit until a file and title are provided', () => {
    render(<UploadAudioFlow onSongReady={() => {}} />)
    expect(screen.getByRole('button', { name: /create song/i })).toBeDisabled()
  })

  it('rejects empty pasted lyrics without creating a song', async () => {
    const onSongReady = vi.fn()
    const { container } = render(<UploadAudioFlow onSongReady={onSongReady} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'My Song' } })
    fireEvent.click(screen.getByText(/paste lyrics/i))
    fireEvent.change(screen.getByPlaceholderText(/paste lyrics/i), { target: { value: '   \n  ' } })

    fireEvent.click(screen.getByRole('button', { name: /create song/i }))

    await waitFor(() => expect(screen.getByText(/no lyric lines found/i)).toBeInTheDocument())
    expect(ingestAudioFile).not.toHaveBeenCalled()
    expect(onSongReady).not.toHaveBeenCalled()
  })

  it('auto-fills empty title and artist from file tags', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({ title: 'Tagged Title', artist: 'Tagged Artist' })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'whatever.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(screen.getByPlaceholderText(/title/i)).toHaveValue('Tagged Title'))
    expect(screen.getByPlaceholderText(/artist/i)).toHaveValue('Tagged Artist')
  })

  it('falls back to the filename (without extension) when there is no title tag', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({})
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'My Eyes Only.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(screen.getByPlaceholderText(/title/i)).toHaveValue('My Eyes Only'))
  })

  it('does not overwrite a title the user already typed', async () => {
    vi.mocked(extractAudioMetadata).mockResolvedValue({ title: 'Tagged Title' })
    const { container } = render(<UploadAudioFlow onSongReady={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'My Manual Title' } })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'song.mp3', { type: 'audio/mpeg' })] } })

    await waitFor(() => expect(extractAudioMetadata).toHaveBeenCalled())
    expect(screen.getByPlaceholderText(/title/i)).toHaveValue('My Manual Title')
  })
})
