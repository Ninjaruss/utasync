import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SongLibrary } from '../../src/sources/SongLibrary'
import { db } from '../../src/core/db/schema'
import type { Song } from '../../src/core/types'

function makeSong(id: string, title: string, createdAt: Date, timed = false): Song {
  return {
    id,
    title,
    artist: `Artist ${id}`,
    lyrics: {
      lines: [{ startTime: 0, endTime: timed ? 5 : 0, original: 'x', translation: '' }],
      sourceLanguage: 'ja',
      translationLanguage: 'en',
      alignmentMode: 'manual',
    },
    createdAt,
    isTrialSong: false,
  }
}

describe('SongLibrary', () => {
  beforeEach(async () => { await db.songs.clear() })

  it('lists saved songs newest-first and opens one on click', async () => {
    await db.songs.put(makeSong('old', 'Older Song', new Date('2026-01-01')))
    await db.songs.put(makeSong('new', 'Newer Song', new Date('2026-02-01')))
    const onOpen = vi.fn()
    render(<SongLibrary onOpen={onOpen} />)

    await waitFor(() => expect(screen.getByText('Newer Song')).toBeInTheDocument())
    const titles = screen.getAllByText(/Song$/).map((el) => el.textContent)
    expect(titles).toEqual(['Newer Song', 'Older Song'])

    fireEvent.click(screen.getByText('Newer Song'))
    expect(onOpen).toHaveBeenCalledWith('new')
  })

  it('shows an alignment hint per song', async () => {
    await db.songs.put(makeSong('t', 'Timed Song', new Date('2026-01-01'), true))
    render(<SongLibrary onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByText('Aligned')).toBeInTheDocument())
  })

  it('deletes a song without opening it', async () => {
    await db.songs.put(makeSong('d', 'Doomed Song', new Date('2026-01-01')))
    const onOpen = vi.fn()
    render(<SongLibrary onOpen={onOpen} />)

    await waitFor(() => expect(screen.getByText('Doomed Song')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))

    await waitFor(() => expect(screen.queryByText('Doomed Song')).not.toBeInTheDocument())
    expect(onOpen).not.toHaveBeenCalled()
    expect(await db.songs.get('d')).toBeUndefined()
  })
})
