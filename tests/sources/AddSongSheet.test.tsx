import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddSongSheet } from '../../src/sources/AddSongSheet'

vi.mock('../../src/sources/LinkParser', () => ({ LinkParser: () => <div>LINK_PARSER</div> }))
vi.mock('../../src/sources/UploadAudioFlow', () => ({ UploadAudioFlow: () => <div>UPLOAD_FLOW</div> }))

describe('AddSongSheet', () => {
  it('defaults to Upload and shows feature tiles', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('UPLOAD_FLOW')).toBeTruthy()
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.getByText('Upload audio')).toBeTruthy()
    expect(screen.getByText('YouTube link')).toBeTruthy()
    expect(screen.getByText(/AI auto-align lyrics/i)).toBeTruthy()
    expect(screen.getByText(/No AI auto-align or clip export/i)).toBeTruthy()
  })

  it('switches to the YouTube link flow when that tile is selected', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /youtube link/i }))
    expect(screen.getByText('LINK_PARSER')).toBeTruthy()
    expect(screen.queryByText('UPLOAD_FLOW')).toBeNull()
  })

  it('closes when the close button is tapped', () => {
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
