import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong as removeSong } from '../core/db/deleteSong'
import { estimateStorageBreakdown, formatBytes, type StorageBreakdown } from '../core/storage/quota'
import { deleteOrphanedAudio, findOrphanedAudioIds } from '../core/storage/cleanup'
import { clearAiModelCache } from '../core/storage/modelCache'
import { exportLRC, downloadFile } from '../lyrics/exporter'
import { useSettingsStore } from '../payment/SettingsStore'
import type { Song } from '../core/types'

interface Props {
  onClose: () => void
}

export function SettingsView({ onClose }: Props) {
  const [songs, setSongs] = useState<Song[]>([])
  const [storage, setStorage] = useState<StorageBreakdown | null>(null)
  const [orphanedAudio, setOrphanedAudio] = useState(0)
  const [cacheMessage, setCacheMessage] = useState<string | null>(null)
  const [clearingCache, setClearingCache] = useState(false)
  const { isPro, trialSongsClaimed, setIsPro } = useSettingsStore()

  const refreshStorage = async (library: Song[]) => {
    setStorage(await estimateStorageBreakdown())
    setOrphanedAudio((await findOrphanedAudioIds(library.map((s) => s.id))).length)
  }

  useEffect(() => {
    db.songs.toArray().then(async (library) => {
      setSongs(library)
      await refreshStorage(library)
    })
  }, [])

  const handleDelete = async (song: Song) => {
    await removeSong(song)
    const next = songs.filter((s) => s.id !== song.id)
    setSongs(next)
    await refreshStorage(next)
  }

  const clearModelCache = async () => {
    setClearingCache(true)
    setCacheMessage(null)
    try {
      const deleted = await clearAiModelCache()
      await refreshStorage(songs)
      setCacheMessage(deleted > 0 ? `Cleared ${deleted} cached model file${deleted === 1 ? '' : 's'}.` : 'Model cache was already empty.')
    } catch {
      setCacheMessage('Could not clear model cache.')
    } finally {
      setClearingCache(false)
    }
  }

  const clearOrphanedAudio = async () => {
    await deleteOrphanedAudio(songs.map((s) => s.id))
    await refreshStorage(songs)
  }

  return (
    <div className="min-h-screen bg-cinnabar-950 text-white px-4 py-4 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-balance">Settings</h1>
        <button onClick={onClose} className="min-h-11 min-w-11 flex items-center justify-center text-white/40 hover:text-white text-xl touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]" aria-label="Close settings">✕</button>
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-1">
        <p className="text-sm font-medium">License</p>
        {isPro
          ? <p className="text-green-400 text-sm">✓ Pro — lifetime access</p>
          : <p className="text-white/50 text-sm">{trialSongsClaimed}/2 trial songs used</p>}
        {import.meta.env.DEV && (
          <button
            onClick={() => setIsPro(!isPro)}
            className="mt-2 text-xs px-3 py-1 rounded-full border border-yellow-500/50 text-yellow-300 hover:bg-yellow-500/10"
          >
            🛠 Dev: {isPro ? 'Disable' : 'Enable'} Pro
          </button>
        )}
      </div>

      {storage && (
        <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium">Storage</p>
          <div className="h-2 bg-cinnabar-800 rounded-full">
            <div
              className={`h-full rounded-full transition-[width,background-color] duration-300 ease-out ${storage.ratio > 0.8 ? 'bg-red-500' : 'bg-cinnabar-accent'}`}
              style={{ width: `${Math.min(storage.ratio * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-white/40">{formatBytes(storage.used)} of {formatBytes(storage.total)} used</p>
          <dl className="space-y-1 pt-1">
            <div className="flex justify-between text-xs">
              <dt className="text-white/50">AI models (cached)</dt>
              <dd className="text-white/40 tabular-nums">{formatBytes(storage.modelCache)}</dd>
            </div>
            <div className="flex justify-between text-xs">
              <dt className="text-white/50">Songs &amp; audio</dt>
              <dd className="text-white/40 tabular-nums">{formatBytes(storage.songsAudio)}</dd>
            </div>
            {storage.other > 0 && (
              <div className="flex justify-between text-xs">
                <dt className="text-white/50">App &amp; library data</dt>
                <dd className="text-white/40 tabular-nums">{formatBytes(storage.other)}</dd>
              </div>
            )}
          </dl>
          {storage.ratio > 0.8 && (
            <p className="text-red-400 text-xs">Storage nearly full. Delete songs to free space.</p>
          )}
          {orphanedAudio > 0 && (
            <p className="text-white/40 text-xs">
              {orphanedAudio} orphaned audio file{orphanedAudio === 1 ? '' : 's'} from interrupted uploads.
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
            <button
              type="button"
              onClick={clearModelCache}
              disabled={clearingCache}
              className="text-xs text-white/30 hover:text-white underline disabled:opacity-50"
            >
              {clearingCache ? 'Clearing…' : 'Clear AI model cache'}
            </button>
            {orphanedAudio > 0 && (
              <button onClick={clearOrphanedAudio} className="text-xs text-white/30 hover:text-white underline">
                Remove orphaned audio
              </button>
            )}
          </div>
          {cacheMessage && (
            <p className="text-xs text-white/50">{cacheMessage}</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Song Library</p>
        {songs.length === 0 && <p className="text-white/30 text-sm">No songs saved.</p>}
        {songs.map((song) => (
          <div key={song.id} className="bg-cinnabar-900 rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{song.title}</p>
              <p className="text-xs text-white/40">{song.artist}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => downloadFile(exportLRC(song.lyrics.lines), `${song.title}.lrc`, 'text/plain')}
                className="min-h-11 px-3 text-xs text-white/40 hover:text-white touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
              >
                LRC
              </button>
              <button onClick={() => handleDelete(song)} className="min-h-11 px-3 text-xs text-red-400 hover:text-red-300 touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
