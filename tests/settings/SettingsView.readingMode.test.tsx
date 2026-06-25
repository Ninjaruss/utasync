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

describe('SettingsView furigana reading mode', () => {
  beforeEach(async () => {
    await db.songs.clear()
    useSettingsStore.setState({ readingMode: 'dictionary' })
  })

  it('defaults to dictionary readings and toggles to sung', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    const toggle = await screen.findByRole('switch', { name: /readings in furigana/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)
    expect(useSettingsStore.getState().readingMode).toBe('sung')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(useSettingsStore.getState().readingMode).toBe('dictionary')
  })
})
