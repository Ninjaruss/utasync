import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong as removeSong } from '../core/db/deleteSong'
import { estimateQuota, formatBytes } from '../core/storage/quota'
import { exportLRC, downloadFile } from '../lyrics/exporter'
import { useSettingsStore } from '../payment/SettingsStore'
import type { Song } from '../core/types'

interface Props {
  onClose: () => void
}

export function SettingsView({ onClose }: Props) {
  const [songs, setSongs] = useState<Song[]>([])
  const [quota, setQuota] = useState<{ used: number; total: number; ratio: number } | null>(null)
  const { isPro, trialSongsClaimed } = useSettingsStore()

  useEffect(() => {
    db.songs.toArray().then(setSongs)
    estimateQuota().then(setQuota)
  }, [])

  const handleDelete = async (song: Song) => {
    await removeSong(song)
    setSongs((prev) => prev.filter((s) => s.id !== song.id))
  }

  const clearModelCache = async () => {
    const cache = await caches.open('ai-models-v1')
    const keys = await cache.keys()
    await Promise.all(keys.map((k) => cache.delete(k)))
    estimateQuota().then(setQuota)
  }

  return (
    <div className="min-h-screen bg-cinnabar-950 text-white p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
      </div>

      <div className="bg-cinnabar-900 rounded-xl p-4 space-y-1">
        <p className="text-sm font-medium">License</p>
        {isPro
          ? <p className="text-green-400 text-sm">✓ Pro — lifetime access</p>
          : <p className="text-white/50 text-sm">{trialSongsClaimed}/2 trial songs used</p>}
      </div>

      {quota && (
        <div className="bg-cinnabar-900 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium">Storage</p>
          <div className="h-2 bg-cinnabar-800 rounded-full">
            <div
              className={`h-full rounded-full transition-all ${quota.ratio > 0.8 ? 'bg-red-500' : 'bg-cinnabar-accent'}`}
              style={{ width: `${Math.min(quota.ratio * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-white/40">{formatBytes(quota.used)} of {formatBytes(quota.total)} used</p>
          {quota.ratio > 0.8 && (
            <p className="text-red-400 text-xs">Storage nearly full. Delete songs to free space.</p>
          )}
          <button onClick={clearModelCache} className="text-xs text-white/30 hover:text-white underline">
            Clear AI model cache
          </button>
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
            <div className="flex gap-2">
              <button
                onClick={() => downloadFile(exportLRC(song.lyrics.lines), `${song.title}.lrc`, 'text/plain')}
                className="text-xs text-white/40 hover:text-white"
              >
                LRC
              </button>
              <button onClick={() => handleDelete(song)} className="text-xs text-red-400 hover:text-red-300">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
