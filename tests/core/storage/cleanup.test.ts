import { describe, it, expect, beforeEach, vi } from 'vitest'
import { findOrphanedAudioIds, deleteOrphanedAudio } from '../../../src/core/storage/cleanup'

type EntryKind = 'file' | 'directory'

/** Minimal OPFS stand-in: a `songs` directory whose entries can be listed and
 *  removed, with per-name removal failures. The real cleanup/audio modules run
 *  against it, so the orphan decision itself is under test (the SettingsView
 *  tests mock this module away). */
function installOpfs(files: Record<string, EntryKind>, failing: string[] = []) {
  const removed: string[] = []
  const songsDir = {
    async *entries() {
      for (const [name, kind] of Object.entries(files)) {
        if (removed.includes(name)) continue
        yield [name, { kind }]
      }
    },
    removeEntry: vi.fn(async (name: string) => {
      if (failing.includes(name)) throw new Error(`removeEntry failed for ${name}`)
      if (!(name in files) || removed.includes(name)) {
        throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
      }
      removed.push(name)
    }),
  }
  const root = { getDirectoryHandle: vi.fn(async () => songsDir) }
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn(async () => root) } })
  return { songsDir, root, removed }
}

describe('findOrphanedAudioIds', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns only audio ids that have no matching song row', async () => {
    installOpfs({
      'keep.mp3': 'file',
      'orphan-1.mp3': 'file',
      'orphan-2.mp3': 'file',
    })

    expect(await findOrphanedAudioIds(['keep'])).toEqual(['orphan-1', 'orphan-2'])
    expect(await findOrphanedAudioIds(['keep', 'orphan-1', 'orphan-2'])).toEqual([])
  })

  it('ignores entries that are not .mp3 files, including directories', async () => {
    installOpfs({
      'cover.jpg': 'file',
      'keep.mp3.tmp': 'file',
      'nested.mp3': 'directory',
      'real-orphan.mp3': 'file',
    })

    expect(await findOrphanedAudioIds([])).toEqual(['real-orphan'])
  })

  it('reports nothing when there is no songs directory yet', async () => {
    const { root } = installOpfs({})
    root.getDirectoryHandle.mockRejectedValue(
      Object.assign(new Error('missing'), { name: 'NotFoundError' }),
    )

    expect(await findOrphanedAudioIds(['a'])).toEqual([])
  })

  it('reports nothing when OPFS itself is unavailable', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn(async () => {
          throw new Error('OPFS unavailable')
        }),
      },
    })

    expect(await findOrphanedAudioIds(['a'])).toEqual([])
  })
})

describe('deleteOrphanedAudio', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes exactly the orphaned files and returns how many were removed', async () => {
    const { songsDir } = installOpfs({
      'keep.mp3': 'file',
      'orphan-1.mp3': 'file',
      'orphan-2.mp3': 'file',
    })

    expect(await deleteOrphanedAudio(['keep'])).toBe(2)
    expect(songsDir.removeEntry.mock.calls.map(([name]) => name)).toEqual([
      'orphan-1.mp3',
      'orphan-2.mp3',
    ])
    expect(await findOrphanedAudioIds(['keep'])).toEqual([])
  })

  // deleteAudio resolves for a missing file, so a rejection here is a real
  // failure. Reporting it as deleted would claim space that was never freed —
  // and letting it reject turned the onClick into an unhandled rejection with
  // no message at all.
  it('counts only real deletions when one file cannot be removed', async () => {
    installOpfs(
      { 'stuck.mp3': 'file', 'gone.mp3': 'file' },
      ['stuck.mp3'],
    )

    await expect(deleteOrphanedAudio([])).resolves.toBe(1)

    // The stuck file is still an orphan, so the caller can say so honestly.
    expect(await findOrphanedAudioIds([])).toEqual(['stuck'])
  })
})
