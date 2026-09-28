import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../src/core/ui/Toast'
import { SettingsView } from '../../src/settings/SettingsView'
import { db } from '../../src/core/db/schema'
import type { Song } from '../../src/core/types'

// The first estimate (mount) succeeds so the storage card is rendered; every
// later one rejects, which is what navigator.storage.estimate() does when the
// API is unavailable. estimateStorageBreakdown awaits estimateQuota directly, so
// a rejection there escapes with no internal try/catch to stop it.
const { estimateCalls } = vi.hoisted(() => ({ estimateCalls: { count: 0 } }))

vi.mock('../../src/core/storage/quota', () => ({
  estimateStorageBreakdown: async () => {
    estimateCalls.count += 1
    if (estimateCalls.count > 1) throw new Error('navigator.storage.estimate rejected')
    return { used: 10, total: 100, ratio: 0.1, modelCache: 0, songsAudio: 10, other: 0 }
  },
  formatBytes: (n: number) => `${n} B`,
}))

vi.mock('../../src/core/storage/cleanup', () => ({
  findOrphanedAudioIds: async () => [],
  deleteOrphanedAudio: async () => 0,
}))

function makeSong(id: string, title: string): Song {
  return {
    id,
    title,
    artist: 'Artist',
    lyrics: { lines: [], sourceLanguage: 'ja', translationLanguage: 'en', alignmentMode: 'manual' },
    createdAt: new Date(),
  }
}

describe('SettingsView delete with a failing storage estimate', () => {
  beforeEach(async () => {
    estimateCalls.count = 0
    await db.songs.clear()
  })

  // A successful delete used to be reported as "Could not delete song. Please
  // try again." (and onSongDeleted was never called, so the library never
  // refreshed and a song open in the player stayed open) purely because the
  // storage breakdown — cosmetic bookkeeping — failed to refresh afterwards.
  it('reports the delete as done, refreshes the library and keeps the last figures', async () => {
    const onSongDeleted = vi.fn()
    await db.songs.put(makeSong('a', 'Delete me'))

    render(
      <ToastProvider>
        <SettingsView onClose={() => {}} embedded onSongDeleted={onSongDeleted} />
      </ToastProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Delete me' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onSongDeleted).toHaveBeenCalledWith('a'))
    expect(await db.songs.get('a')).toBeUndefined()
    // The delete was not reported as failed…
    expect(screen.queryByText(/could not delete song/i)).toBeNull()
    // …and the storage card is still there, showing the last known figures.
    expect(screen.getByText('10 B of 100 B used')).toBeTruthy()
  })

  it('still reports a genuine delete failure as a failure', async () => {
    const onSongDeleted = vi.fn()
    const song = makeSong('b', 'Keep me')
    await db.songs.put(song)
    const realDelete = db.songs.delete
    db.songs.delete = (async () => {
      throw new Error('IndexedDB write failed')
    }) as unknown as typeof db.songs.delete

    try {
      render(
        <ToastProvider>
          <SettingsView onClose={() => {}} embedded onSongDeleted={onSongDeleted} />
        </ToastProvider>,
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Delete Keep me' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      expect(await screen.findByText(/could not delete song/i)).toBeTruthy()
      expect(onSongDeleted).not.toHaveBeenCalled()
      expect(await db.songs.get('b')).toBeDefined()
    } finally {
      db.songs.delete = realDelete
    }
  })
})
