import { useEffect, useState } from 'react'
import { db } from '../core/db/schema'
import { deleteSong } from '../core/db/deleteSong'
import { computeSyncState } from '../core/db/migrations'
import type { Song } from '../core/types'

interface Props {
  onOpen: (songId: string) => void
  onAdd: () => void
  onSettings: () => void
}

export function LibraryScreen({ onOpen, onAdd, onSettings }: Props) {
  const [songs, setSongs] = useState<Song[]>([])

  useEffect(() => {
    db.songs.orderBy('createdAt').reverse().toArray().then(setSongs)
  }, [])

  const handleDelete = async (song: Song) => {
    await deleteSong(song)
    setSongs((prev) => prev.filter((s) => s.id !== song.id))
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-cinnabar-950 flex flex-col">
      <div className="w-full max-w-2xl mx-auto flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <span className="text-cinnabar-accent font-semibold tracking-widest text-lg">歌sync</span>
        <button onClick={onSettings} className="min-h-11 px-2 text-white/40 hover:text-white text-xs touch-manipulation transition-colors duration-150 ease-out">⚙ Settings</button>
      </div>

      <div className="px-4 pb-3 shrink-0">
        <button onClick={onAdd}
          className="w-full py-3 rounded-xl bg-cinnabar-accent text-white font-semibold text-sm flex items-center justify-center gap-2 touch-manipulation transition-[transform,background-color] duration-150 ease-out active:scale-[0.98]">
          ＋ Add a song
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2">
        {songs.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-white/30 text-sm py-20">No songs yet</div>
        )}
        {songs.map((song) => {
          const sync = song.syncState ?? computeSyncState(song)
          return (
            <div key={song.id} onClick={() => onOpen(song.id)}
              className="bg-cinnabar-900 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-cinnabar-800 transition-[background-color] duration-150 ease-out active:scale-[0.99] touch-manipulation min-h-[3.75rem]">
              <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-cinnabar-accent to-cinnabar-800 shrink-0 overflow-hidden">
                {song.albumArtUrl && <img src={song.albumArtUrl} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{song.title}</p>
                <p className="text-xs text-white/40 truncate">{song.artist}</p>
              </div>
              <span className={`text-[10px] rounded-full border px-2 py-0.5 shrink-0 ${sync === 'synced' ? 'border-white/20 text-white/50' : 'border-cinnabar-accent/60 text-cinnabar-accent'}`}>
                {sync === 'synced' ? 'synced' : 'needs sync'}
              </span>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(song) }}
                className="min-w-11 min-h-11 flex items-center justify-center text-xs text-red-400 hover:text-red-300 shrink-0 touch-manipulation transition-colors duration-150 ease-out active:scale-[0.96]"
                aria-label={`Delete ${song.title}`}>✕</button>
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}
