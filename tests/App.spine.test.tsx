import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../src/core/db/schema'
import App from '../src/App'

vi.mock('../src/sources/AddSongSheet', () => ({ AddSongSheet: () => <div>ADD_SHEET</div> }))

beforeEach(async () => {
  await db.songs.clear()
  // This spec exercises the library → Add-sheet navigation, so start as a
  // returning visitor (the landing page is only shown on the first visit).
  localStorage.setItem('utasync_landing_seen', '1')
})

describe('App navigation spine', () => {
  it('opens the Add sheet from the Library', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /add a song/i }))
    fireEvent.click(screen.getByRole('button', { name: /add a song/i }))
    expect(screen.getByText('ADD_SHEET')).toBeTruthy()
  })

  it('shows the landing page to a first-time visitor and can enter the app', async () => {
    localStorage.removeItem('utasync_landing_seen')
    render(<App />)
    // Lazy-loaded landing — wait for its CTA, then enter the library.
    await waitFor(() => screen.getByRole('button', { name: /open the app/i }))
    expect(screen.getAllByRole('button', { name: /try the demo/i }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /open the app/i }))
    await waitFor(() => screen.getByRole('button', { name: /add a song/i }))
    // Returning now skips the landing.
    expect(localStorage.getItem('utasync_landing_seen')).toBe('1')
  })
})
