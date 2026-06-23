import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { SettingsView } from '../../src/settings/SettingsView'
import { db } from '../../src/core/db/schema'
import { LEGAL_PATHS } from '../../src/core/legal'

vi.mock('../../src/core/storage/quota', () => ({
  estimateStorageBreakdown: async () => ({
    used: 0,
    total: 1,
    ratio: 0,
    modelCache: 0,
    songsAudio: 0,
    other: 0,
  }),
  formatBytes: (n: number) => `${n} B`,
}))

vi.mock('../../src/core/storage/cleanup', () => ({
  findOrphanedAudioIds: async () => [],
  deleteOrphanedAudio: async () => {},
}))

describe('SettingsView legal links', () => {
  beforeEach(async () => {
    await db.songs.clear()
  })

  it('shows privacy and terms links in the legal section', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    expect(await screen.findByRole('navigation', { name: 'Legal' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', LEGAL_PATHS.privacy)
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', LEGAL_PATHS.terms)
  })
})
