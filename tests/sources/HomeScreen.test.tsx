// tests/sources/HomeScreen.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HomeScreen } from '../../src/sources/HomeScreen'
import { db } from '../../src/core/db/schema'

describe('HomeScreen', () => {
  beforeEach(async () => { await db.songs.clear() })

  it('shows the YouTube link flow by default and switches to upload', () => {
    render(<HomeScreen onSongReady={() => {}} />)
    expect(screen.getByPlaceholderText(/youtube link/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /upload audio/i }))
    expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument()
  })

  it('exposes a My Songs tab and lands on it when songs exist', async () => {
    await db.songs.put({
      id: 's1', title: 'Saved Song', artist: 'A',
      lyrics: { lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
      createdAt: new Date(), isTrialSong: false,
    })
    render(<HomeScreen onSongReady={() => {}} />)

    expect(screen.getByRole('button', { name: /my songs/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Saved Song')).toBeInTheDocument())
  })
})
