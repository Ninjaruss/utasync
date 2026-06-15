// tests/sources/UploadAudioFlow.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UploadAudioFlow } from '../../src/sources/UploadAudioFlow'

vi.mock('../../src/sources/audioIngest', () => ({
  ingestAudioFile: vi.fn(async () => ({ songId: 'id1', audioStoredPath: 'songs/id1.mp3' })),
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
})
