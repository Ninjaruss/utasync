// tests/sources/UploadAudioFlow.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UploadAudioFlow } from '../../src/sources/UploadAudioFlow'

const ingestAudioFile = vi.fn(async () => ({ songId: 'id1', audioStoredPath: 'songs/id1.mp3' }))
vi.mock('../../src/sources/audioIngest', () => ({
  ingestAudioFile: (file: File) => ingestAudioFile(file),
}))

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
})
