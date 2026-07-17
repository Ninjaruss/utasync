import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { SettingsView } from '../../src/settings/SettingsView'
import { db } from '../../src/core/db/schema'

// Near-full storage (ratio > 0.8) so the "nearly full" warning renders.
vi.mock('../../src/core/storage/quota', () => ({
  estimateStorageBreakdown: async () => ({
    used: 920_000_000,
    total: 1_000_000_000,
    ratio: 0.92,
    modelCache: 0,
    songsAudio: 920_000_000,
    other: 0,
  }),
  formatBytes: (n: number) => `${Math.round(n / 1_000_000)} MB`,
}))

vi.mock('../../src/core/storage/cleanup', () => ({
  findOrphanedAudioIds: async () => [],
  deleteOrphanedAudio: async () => {},
}))

describe('SettingsView near-full storage warning', () => {
  beforeEach(async () => {
    await db.songs.clear()
  })

  it('surfaces the near-full message as a role=alert InlineError', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/storage nearly full\. delete songs to free space\./i)
  })
})
