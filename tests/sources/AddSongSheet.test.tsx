import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddSongSheet } from '../../src/sources/AddSongSheet'

vi.mock('../../src/sources/LinkParser', () => ({ LinkParser: () => <div>LINK_PARSER</div> }))
vi.mock('../../src/sources/UploadAudioFlow', () => ({ UploadAudioFlow: () => <div>UPLOAD_FLOW</div> }))

describe('AddSongSheet', () => {
  it('defaults to Link and toggles to Upload', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('LINK_PARSER')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /upload audio/i }))
    expect(screen.getByText('UPLOAD_FLOW')).toBeTruthy()
  })

  it('closes when the backdrop dismiss is tapped', () => {
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
