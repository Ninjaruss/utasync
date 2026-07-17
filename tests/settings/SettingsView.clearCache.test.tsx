import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsView } from '../../src/settings/SettingsView'
import { db } from '../../src/core/db/schema'

vi.mock('../../src/core/storage/quota', () => ({
  estimateStorageBreakdown: async () => ({
    used: 240_000_000,
    total: 1_000_000_000,
    ratio: 0.24,
    modelCache: 240_000_000,
    songsAudio: 0,
    other: 0,
  }),
  formatBytes: (n: number) => `${Math.round(n / 1_000_000)} MB`,
}))

vi.mock('../../src/core/storage/cleanup', () => ({
  findOrphanedAudioIds: async () => [],
  deleteOrphanedAudio: async () => {},
}))

const clearAiModelCache = vi.fn(async () => 3)
vi.mock('../../src/core/storage/modelCache', () => ({
  clearAiModelCache: () => clearAiModelCache(),
}))

describe('SettingsView clear-cache confirmation', () => {
  beforeEach(async () => {
    await db.songs.clear()
    clearAiModelCache.mockClear()
  })

  it('requires an explicit confirm before clearing, and states the consequence', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    // First tap arms the confirm — it must NOT clear yet.
    const trigger = await screen.findByRole('button', { name: /clear ai model cache/i })
    fireEvent.click(trigger)
    expect(clearAiModelCache).not.toHaveBeenCalled()
    // Consequence is stated, with the cached size (text nodes are split by the
    // JSX ternary, so match the span's full text content in one matcher).
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'SPAN' && /re-download next time you align.*240 MB/i.test(el.textContent ?? ''),
      ),
    ).toBeTruthy()
    // Confirm actually clears.
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }))
    await waitFor(() => expect(clearAiModelCache).toHaveBeenCalledTimes(1))
  })

  it('cancel dismisses the confirm without clearing', async () => {
    render(<SettingsView onClose={() => {}} embedded />)
    fireEvent.click(await screen.findByRole('button', { name: /clear ai model cache/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(clearAiModelCache).not.toHaveBeenCalled()
    // Back to the un-armed trigger.
    expect(screen.getByRole('button', { name: /clear ai model cache/i })).toBeTruthy()
  })
})
