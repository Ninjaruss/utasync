import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../../src/core/db/schema'
import { LibraryScreen } from '../../src/sources/LibraryScreen'

beforeEach(async () => {
  await db.songs.clear()
  await db.songs.bulkPut([
    { id: '1', title: 'Synced Song', artist: 'A', syncState: 'synced', sources: [], lyrics: { lines: [{ startTime: 1, endTime: 2, original: 'a', translation: '' }], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' }, createdAt: new Date(1), isTrialSong: false },
    { id: '2', title: 'Unsynced Song', artist: 'B', syncState: 'needs-sync', sources: [], lyrics: { lines: [{ startTime: 0, endTime: 0, original: 'b', translation: '' }], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' }, createdAt: new Date(2), isTrialSong: false },
  ] as never)
})

describe('LibraryScreen', () => {
  it('lists songs and shows a needs-sync badge', async () => {
    render(<LibraryScreen onOpen={vi.fn()} onAdd={vi.fn()} onSettings={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Synced Song')).toBeTruthy())
    expect(screen.getByText(/needs sync/i)).toBeTruthy()
  })

  it('fires onAdd when the add button is tapped', async () => {
    const onAdd = vi.fn()
    render(<LibraryScreen onOpen={vi.fn()} onAdd={onAdd} onSettings={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /add a song/i }))
    expect(onAdd).toHaveBeenCalled()
  })

  it('opens a song on tap', async () => {
    const onOpen = vi.fn()
    render(<LibraryScreen onOpen={onOpen} onAdd={vi.fn()} onSettings={vi.fn()} />)
    await waitFor(() => screen.getByText('Synced Song'))
    fireEvent.click(screen.getByRole('button', { name: /Open Synced Song/i }))
    expect(onOpen).toHaveBeenCalledWith('1')
  })
})
