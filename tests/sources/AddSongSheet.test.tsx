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

  it('closes on backdrop tap when nothing has been entered', () => {
    // The generic `[aria-hidden="true"]` selector this test used to use matched
    // a decorative checkmark span instead of the real backdrop — it passed by
    // accident and never actually exercised backdrop-tap behavior. The backdrop
    // is now correctly aria-hidden itself (see the initial-focus test below).
    // getByRole's `name` matcher computes an empty accessible name for an
    // aria-hidden element even with `hidden: true` (that option only restores
    // the element to the role query, not to name computation), so the backdrop
    // has to be picked out by its aria-label attribute directly.
    // `AddSongSheet.dirtyClose.test.tsx` covers the full busy/dirty
    // confirmation matrix for this same click.
    const onClose = vi.fn()
    render(<AddSongSheet onSongReady={vi.fn()} onClose={onClose} />)
    const backdrop = screen
      .getAllByRole('button', { hidden: true })
      .find((el) => el.getAttribute('aria-label') === 'Dismiss')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop!)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not put initial focus on the invisible backdrop button', () => {
    // The backdrop button is a full-screen sibling inside the focus trap. Before
    // it was marked aria-hidden, useModalDialog's `focusableWithin` resolved it
    // as the panel's first focusable element, so a keyboard/screen-reader user
    // opening the sheet landed on an invisible "Dismiss" control instead of the
    // first real control (the visible "Close" button).
    render(<AddSongSheet onSongReady={vi.fn()} onClose={vi.fn()} />)
    expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Dismiss')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
  })
})
