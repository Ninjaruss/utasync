import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { AddSongSheet } from '../../src/sources/AddSongSheet'

// Stubs standing in for the two flows: each can report itself dirty (pasted
// lyrics, a chosen file) the way the real ones do.
vi.mock('../../src/sources/UploadAudioFlow', () => ({
  UploadAudioFlow: ({ onDirtyChange }: { onDirtyChange: (d: boolean) => void }) => (
    <div>
      <span>UPLOAD_FLOW</span>
      <button type="button" onClick={() => onDirtyChange(true)}>dirty-upload</button>
    </div>
  ),
}))
vi.mock('../../src/sources/LinkParser', () => ({
  LinkParser: () => <div>LINK_FLOW</div>,
}))

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

const tile = (name: RegExp) => screen.getByRole('button', { name })

describe('switching add-song source', () => {
  it('switches freely while nothing has been entered', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('UPLOAD_FLOW')).toBeTruthy()

    fireEvent.click(tile(/youtube link/i))
    expect(screen.getByText('LINK_FLOW')).toBeTruthy()
  })

  // Regression: the tiles are full-width and adjacent on a phone, so a mistap
  // silently unmounted the flow and took the file, the edited metadata and 40
  // pasted lines with it — work the ✕ and the backdrop both confirm.
  it('confirms before discarding work in progress', async () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'dirty-upload' }))

    fireEvent.click(tile(/youtube link/i))

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    expect(screen.getByText('UPLOAD_FLOW')).toBeTruthy() // not switched yet
  })

  it('keeps the current flow when the switch is declined', async () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'dirty-upload' }))
    fireEvent.click(tile(/youtube link/i))
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: /keep what i have/i }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByText('UPLOAD_FLOW')).toBeTruthy()
  })

  it('switches once the user confirms', async () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'dirty-upload' }))
    fireEvent.click(tile(/youtube link/i))
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))

    await waitFor(() => expect(screen.getByText('LINK_FLOW')).toBeTruthy())
  })

  // The Back gesture shares the close guard, so it must not slip past the same
  // work the ✕ protects.
  it('routes the system Back gesture through the discard guard when dirty', async () => {
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'dirty-upload' }))

    await act(async () => {
      window.history.back()
      await new Promise((r) => setTimeout(r, 0))
    })

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not confirm when the tapped tile is the one already open', () => {
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'dirty-upload' }))

    fireEvent.click(tile(/upload audio/i))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
