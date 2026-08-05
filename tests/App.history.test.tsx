import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { db } from '../src/core/db/schema'
import App from '../src/App'

// The routing spine is what's under test here, not the player itself.
vi.mock('../src/player/PlayerView', () => ({
  PlayerView: ({ songId, onBack }: { songId: string; onBack: () => void }) => (
    <div>
      <span>PLAYER:{songId}</span>
      <button type="button" onClick={onBack}>← Back</button>
    </div>
  ),
}))
vi.mock('../src/sources/AddSongSheet', () => ({ AddSongSheet: () => <div>ADD_SHEET</div> }))

const goBack = async () => {
  await act(async () => {
    window.history.back()
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(async () => {
  localStorage.setItem('utasync_landing_seen', '1')
  localStorage.setItem('utasync_onboarding_seen', '1')
  window.history.replaceState(null, '', '/')
  await db.songs.clear()
  await db.songs.put({
    id: 'song1', title: 'Song One', artist: 'A',
    lyrics: { lines: [{ startTime: 0, endTime: 1, original: 'x', translation: '' }], sourceLanguage: 'en', translationLanguage: 'en', alignmentMode: 'manual' },
    syncState: 'synced', createdAt: new Date(),
  } as never)
})

describe('App history spine', () => {
  it('makes a song deep-linkable and returnable with the browser Back button', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /open song one/i }))
    fireEvent.click(screen.getByRole('button', { name: /open song one/i }))

    await waitFor(() => expect(screen.getByText('PLAYER:song1')).toBeTruthy())
    expect(window.location.hash).toBe('#/song/song1')

    await goBack()
    await waitFor(() => expect(screen.queryByText('PLAYER:song1')).toBeNull())
  })

  // Regression: leaving a song used to PUSH '#/', so history became
  // [library, song, library] and the phone Back gesture re-opened the song the
  // user had just closed.
  it('does not leave a forward song entry behind when ← Back is used', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /open song one/i }))
    fireEvent.click(screen.getByRole('button', { name: /open song one/i }))
    await waitFor(() => expect(screen.getByText('PLAYER:song1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '← Back' }))
    await waitFor(() => expect(screen.queryByText('PLAYER:song1')).toBeNull())

    // The next Back must not resurrect the song.
    await goBack()
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByText('PLAYER:song1')).toBeNull()
  })

  it('lands on the library — not a frozen view — when Back reaches an empty hash', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('button', { name: /open song one/i }))
    fireEvent.click(screen.getByRole('button', { name: /open song one/i }))
    await waitFor(() => expect(screen.getByText('PLAYER:song1')).toBeTruthy())

    await goBack()
    await waitFor(() => expect(screen.getByRole('button', { name: /add a song/i })).toBeTruthy())
  })

  it('still opens a song from a deep link on a cold load', async () => {
    window.history.replaceState(null, '', '#/song/song1')
    render(<App />)
    await waitFor(() => expect(screen.getByText('PLAYER:song1')).toBeTruthy())
  })

  // A deep link has no library entry to pop back to, so ← Back must still work.
  it('returns to the library from a deep link even with nothing to pop', async () => {
    window.history.replaceState(null, '', '#/song/song1')
    render(<App />)
    await waitFor(() => expect(screen.getByText('PLAYER:song1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '← Back' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /add a song/i })).toBeTruthy())
  })
})
