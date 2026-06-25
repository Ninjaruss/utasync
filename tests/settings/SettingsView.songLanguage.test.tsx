import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsView } from '../../src/settings/SettingsView'
import { db } from '../../src/core/db/schema'
import { useSettingsStore } from '../../src/payment/SettingsStore'

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

describe('SettingsView song language', () => {
  beforeEach(async () => {
    await db.songs.clear()
    useSettingsStore.setState({ defaultSongLanguage: 'ja' })
  })

  it('defaults to Japanese and can switch to English', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    const ja = await screen.findByRole('button', { name: 'Japanese' })
    const en = screen.getByRole('button', { name: 'English' })
    expect(ja).toHaveAttribute('aria-pressed', 'true')
    expect(en).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(en)
    expect(useSettingsStore.getState().defaultSongLanguage).toBe('en')
    expect(en).toHaveAttribute('aria-pressed', 'true')
  })
})
