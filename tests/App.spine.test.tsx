import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../src/core/db/schema'
import App from '../src/App'

vi.mock('../src/sources/AddSongSheet', () => ({ AddSongSheet: () => <div>ADD_SHEET</div> }))

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

beforeEach(async () => {
  await db.songs.clear()
  // This spec exercises the library → Add-sheet navigation, so start as a
  // returning visitor (the landing page is only shown on the first visit).
  localStorage.setItem('utasync_landing_seen', '1')
})

afterEach(() => setOnline(true))

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
    await waitFor(() => screen.getAllByRole('button', { name: /open the app/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /open the app/i })[0])
    await waitFor(() => screen.getByRole('button', { name: /add a song/i }))
    // Returning now skips the landing.
    expect(localStorage.getItem('utasync_landing_seen')).toBe('1')
  })

  it('renders the offline banner in normal flow, above the library (not overlapping it)', async () => {
    // OfflineBanner reads navigator.onLine at mount, so flip it before render.
    setOnline(false)
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /add a song/i }))

    const banner = screen.getByText(/you.re offline/i)
    const libraryControl = screen.getByRole('button', { name: /add a song/i })
    // Both are in the tree: the banner does not replace or hide the main view…
    expect(banner).toBeTruthy()
    expect(libraryControl).toBeTruthy()
    // …and the banner is a sibling row BEFORE the view (normal flow), so the
    // library follows it in document order rather than being painted over.
    expect(
      banner.compareDocumentPosition(libraryControl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // The banner is not inside a position:fixed overlay wrapper anymore.
    expect(banner.closest('.fixed')).toBeNull()
  })
})
