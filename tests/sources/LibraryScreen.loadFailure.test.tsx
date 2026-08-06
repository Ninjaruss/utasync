import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { LibraryScreen } from '../../src/sources/LibraryScreen'
import { db } from '../../src/core/db/schema'

const props = { onOpen: vi.fn(), onAdd: vi.fn(), onSettings: vi.fn() }

afterEach(() => vi.restoreAllMocks())
beforeEach(async () => { await db.songs.clear() })

describe('LibraryScreen when storage is unavailable', () => {
  // Regression: a rejected query left the skeleton pulsing for ever, so a
  // private-browsing user watched an empty library load with nothing to react to.
  it('explains the failure instead of pulsing the skeleton for ever', async () => {
    vi.spyOn(db.songs, 'orderBy').mockReturnValue({
      reverse: () => ({ toArray: () => Promise.reject(new Error('storage blocked')) }),
    } as never)

    render(<LibraryScreen {...props} />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/couldn't open your library/i)
    expect(screen.queryByText(/loading songs/i)).toBeNull()
  })

  it('reassures the user their songs are still there, and offers a retry', async () => {
    vi.spyOn(db.songs, 'orderBy').mockReturnValue({
      reverse: () => ({ toArray: () => Promise.reject(new Error('storage blocked')) }),
    } as never)

    render(<LibraryScreen {...props} />)
    await screen.findByRole('alert')

    expect(screen.getByText(/still saved/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('does not claim failure when the library is simply empty', async () => {
    render(<LibraryScreen {...props} />)
    await waitFor(() => expect(screen.getByText(/your library is empty/i)).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
